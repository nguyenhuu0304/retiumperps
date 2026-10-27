/** Executable specification ONLY. This is not a deployed contract or chain adapter.
 * `caller` represents runtime-authenticated identity in the test harness.
 * Adapter rollback models a required VM guarantee; tests do not prove that guarantee on Retium.
 */
export const MAX_CUSTODY = 10n ** 27n;
export type Asset = { id: string; codeHash: string };
export interface TokenRuntime {
  identity(): Asset;
  balance(account: string): bigint;
  transferFrom(owner: string, recipient: string, amount: bigint): unknown;
  transfer(owner: string, recipient: string, amount: bigint): unknown;
  checkpoint(): unknown;
  rollback(checkpoint: unknown): void;
}
function requireThat(condition: boolean, error: string): asserts condition {
  if (!condition) throw new Error(error);
}
function successful(reply: unknown) {
  requireThat(typeof reply === 'object' && reply !== null &&
    (reply as {ok?: unknown}).ok === true && !('error' in reply), 'TOKEN_REPLY_NOT_SUCCESS');
}
export class CustodyModel {
  private credits = new Map<string, bigint>();
  private total = 0n;
  private initialized = false;
  private paused = true;
  private entered = false;
  private readonly asset: Readonly<Asset>;
  private readonly owner: string;
  private readonly vault: string;
  private readonly runtime: TokenRuntime;
  constructor(owner: string, vault: string, asset: Asset, runtime: TokenRuntime) {
    this.owner = owner; this.vault = vault; this.runtime = runtime;
    requireThat(owner.length > 0 && vault.length > 0 && owner !== vault, 'INVALID_CONFIGURATION');
    this.asset = Object.freeze({...asset});
  }
  private identity() {
    const actual = this.runtime.identity();
    requireThat(actual.id === this.asset.id && actual.codeHash === this.asset.codeHash, 'ASSET_IDENTITY_MISMATCH');
  }
  initialize(caller: string) {
    requireThat(caller === this.owner, 'OWNER_ONLY');
    requireThat(!this.initialized, 'ALREADY_INITIALIZED');
    this.identity(); this.initialized = true;
  }
  setPaused(caller: string, paused: boolean) {
    requireThat(!this.entered, 'REENTRANCY');
    requireThat(caller === this.owner && this.initialized, 'OWNER_ONLY');
    this.paused = paused;
  }
  balanceOf(account: string) { return this.credits.get(account) ?? 0n; }
  liabilities() { return this.total; }
  private atomic(run: () => void) {
    requireThat(!this.entered, 'REENTRANCY');
    requireThat(this.initialized, 'NOT_INITIALIZED');
    const oldCredits = new Map(this.credits), oldTotal = this.total;
    const checkpoint = this.runtime.checkpoint();
    this.entered = true;
    try {
      this.identity(); run();
      requireThat(this.runtime.balance(this.vault) >= this.total, 'INSOLVENT');
    } catch (e) {
      this.credits = oldCredits; this.total = oldTotal;
      this.runtime.rollback(checkpoint); throw e;
    } finally { this.entered = false; }
  }
  deposit(caller: string, amount: bigint) {
    this.atomic(() => {
      requireThat(!this.paused, 'DEPOSITS_PAUSED');
      requireThat(caller.length > 0 && caller !== this.vault, 'INVALID_CALLER');
      requireThat(amount > 0n && amount <= MAX_CUSTODY && this.total + amount <= MAX_CUSTODY, 'AMOUNT_LIMIT');
      const before = this.runtime.balance(this.vault), userBefore = this.runtime.balance(caller);
      successful(this.runtime.transferFrom(caller, this.vault, amount));
      requireThat(this.runtime.balance(this.vault) - before === amount &&
        userBefore - this.runtime.balance(caller) === amount, 'TOKEN_DELTA_MISMATCH');
      this.credits.set(caller, this.balanceOf(caller) + amount); this.total += amount;
    });
  }
  withdraw(caller: string, amount: bigint) {
    this.atomic(() => {
      requireThat(amount > 0n && amount <= this.balanceOf(caller), 'INSUFFICIENT_CREDIT');
      const before = this.runtime.balance(this.vault), userBefore = this.runtime.balance(caller);
      this.credits.set(caller, this.balanceOf(caller) - amount); this.total -= amount;
      // Destination is always the authenticated caller. No owner sweep or arbitrary recipient.
      successful(this.runtime.transfer(this.vault, caller, amount));
      requireThat(before - this.runtime.balance(this.vault) === amount &&
        this.runtime.balance(caller) - userBefore === amount, 'TOKEN_DELTA_MISMATCH');
    });
  }
}
