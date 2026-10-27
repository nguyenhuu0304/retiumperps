#![cfg_attr(target_arch = "wasm32", no_std)]
//! Offline reference model, not a deployable vault. No token calls, signing or settlement.
//! Monetary values are positive atomic units (18 decimals at application boundary).

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LedgerError { ZeroAmount, Overflow, InsufficientBalance, InsufficientFree, Insolvent, InvalidSettlement }

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct VaultLedger {
    /// Tokens held in the model vault, not an RPC token balance.
    pub assets: u128,
    /// Total user claims: free + locked, never includes fictitious trading profit.
    pub liabilities: u128,
    pub free: u128,
    pub locked: u128,
}
impl VaultLedger {
    fn check(&self) -> Result<(), LedgerError> {
        let claims = self.free.checked_add(self.locked).ok_or(LedgerError::Overflow)?;
        if self.liabilities != claims || self.assets < self.liabilities { return Err(LedgerError::Insolvent) }
        Ok(())
    }
    pub fn deposit(&mut self, amount: u128) -> Result<(), LedgerError> {
        if amount == 0 { return Err(LedgerError::ZeroAmount) }
        let mut n=*self;
        n.assets=n.assets.checked_add(amount).ok_or(LedgerError::Overflow)?;
        n.liabilities=n.liabilities.checked_add(amount).ok_or(LedgerError::Overflow)?;
        n.free=n.free.checked_add(amount).ok_or(LedgerError::Overflow)?;
        n.check()?; *self=n; Ok(())
    }
    pub fn lock(&mut self, amount: u128) -> Result<(), LedgerError> {
        if amount == 0 { return Err(LedgerError::ZeroAmount) }
        let mut n=*self;
        n.free=n.free.checked_sub(amount).ok_or(LedgerError::InsufficientFree)?;
        n.locked=n.locked.checked_add(amount).ok_or(LedgerError::Overflow)?;
        n.check()?; *self=n; Ok(())
    }
    pub fn unlock(&mut self, amount: u128) -> Result<(), LedgerError> {
        if amount == 0 { return Err(LedgerError::ZeroAmount) }
        let mut n=*self;
        n.locked=n.locked.checked_sub(amount).ok_or(LedgerError::InsufficientBalance)?;
        n.free=n.free.checked_add(amount).ok_or(LedgerError::Overflow)?;
        n.check()?; *self=n; Ok(())
    }
    pub fn withdraw(&mut self, amount: u128) -> Result<(), LedgerError> {
        if amount == 0 { return Err(LedgerError::ZeroAmount) }
        let mut n=*self;
        n.free=n.free.checked_sub(amount).ok_or(LedgerError::InsufficientFree)?;
        n.assets=n.assets.checked_sub(amount).ok_or(LedgerError::InsufficientBalance)?;
        n.liabilities=n.liabilities.checked_sub(amount).ok_or(LedgerError::InsufficientBalance)?;
        n.check()?; *self=n; Ok(())
    }
    /// Only realized backed profit can increase user claims. The reserve must physically exist.
    /// This demo intentionally rejects all credit-increasing PnL payouts; future implementation
    /// needs audited insurance/liquidity reserves, authenticated fills and authorization.
    pub fn claim_unbacked_profit(&mut self, _amount:u128) -> Result<(),LedgerError> {
        Err(LedgerError::InvalidSettlement)
    }
}
#[cfg(test)]
mod tests {
use super::*;
#[test] fn deposit_lock_unlock_withdraw_roundtrip(){let mut v=VaultLedger::default();v.deposit(1000).unwrap();v.lock(400).unwrap();assert_eq!((v.free,v.locked,v.liabilities,v.assets),(600,400,1000,1000));v.unlock(400).unwrap();v.withdraw(1000).unwrap();assert_eq!(v,VaultLedger::default());}
#[test] fn cannot_withdraw_locked(){let mut v=VaultLedger::default();v.deposit(100).unwrap();v.lock(80).unwrap();let old=v;assert_eq!(v.withdraw(21),Err(LedgerError::InsufficientFree));assert_eq!(v,old);}
#[test] fn cannot_unlock_more(){let mut v=VaultLedger::default();v.deposit(100).unwrap();let old=v;assert_eq!(v.unlock(1),Err(LedgerError::InsufficientBalance));assert_eq!(v,old);}
#[test] fn empty_operations_rejected(){let mut v=VaultLedger::default();assert_eq!(v.deposit(0),Err(LedgerError::ZeroAmount));assert_eq!(v.lock(0),Err(LedgerError::ZeroAmount));assert_eq!(v.withdraw(0),Err(LedgerError::ZeroAmount));}
#[test] fn overflow_is_atomic(){let mut v=VaultLedger::default();v.deposit(u128::MAX).unwrap();let old=v;assert_eq!(v.deposit(1),Err(LedgerError::Overflow));assert_eq!(v,old);}
#[test] fn no_unbacked_profit(){let mut v=VaultLedger::default();v.deposit(100).unwrap();let old=v;assert_eq!(v.claim_unbacked_profit(1),Err(LedgerError::InvalidSettlement));assert_eq!(v,old);}
#[test] fn insolvency_rejected(){let mut v=VaultLedger::default();v.deposit(100).unwrap();v.assets=99;let old=v;assert_eq!(v.lock(1),Err(LedgerError::Insolvent));assert_eq!(v,old);}
#[test] fn lock_and_unlock_preserve_claims(){let mut v=VaultLedger::default();v.deposit(100).unwrap();v.lock(51).unwrap();assert_eq!(v.liabilities,100);v.unlock(25).unwrap();assert_eq!((v.free,v.locked,v.liabilities),(74,26,100));}
}
