# Retium Perps custody probe v0.2.0

Contract AssemblyScript đã biên dịch thành `build/retium_perps_custody.wasm`. Đây là **contract thử nghiệm nạp/rút riêng**, chưa deploy và không có Long/Short, oracle, funding hay quỹ trả lãi.

Không sửa Retium Pay, giao diện Perps, package.json cấp app, .env, khóa ví, DB hoặc pending TX. Không yêu cầu chạy lại bài thử thủ công Long/Short.

## Cấu hình ghim trong WASM

- Initializer/admin: `retef25ddec9d77f15810718a59551061df10024179bc6da4952432f236448575a88cb37` (ví 37).
- Candidate RTD: `c1d3885930a23a099e28e6f55f8ee8d8908902b57a7ef9d28de6756819d5611c`.
- Candidate code hash: `5c6b3392d5f3769522befe48cb5dc53db3e633e2f3a63f29abba74433ef768a2`.
- Đây là ID/hash đã dùng ở thử nghiệm cũ; phải đối chiếu mạng hiện tại, nguồn chính thức và hành vi token trước khi dùng. Script chỉ xác nhận khớp cấu hình, không chứng nhận official RTD.
- 1 RTD tối đa số dư mỗi ví, 10 RTD tổng liabilities; không có cách tăng cap trong contract.
- Khởi tạo PAUSED. Admin chỉ được pause/unpause nạp. Không có sweep, đổi token, rút hộ hoặc đổi owner.
- Rút luôn về caller, kể cả đang pause. Nếu code hash token đổi, rút cũng bị chặn: probe không có đường khẩn cấp bỏ qua hash; cần đánh giá thiết kế nâng cấp trước công khai.
- Caller của lệnh ghi phải là ví; không hỗ trợ smart wallet/contract callers trong probe này.
- Không nhận RTM đính kèm. Không chuyển RTM, không giữ tài sản làm vị thế.

## Bước hiện tại trên PowerShell

Từ thư mục `D:\Projects\Retium\retium-perps`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\perps-custody-preflight.ps1"
```

Lệnh này chỉ đọc metadata token và SHA256 file WASM. Chưa dùng private key, chưa deploy, chưa cần approve. Gửi output không chứa khóa để đối chiếu trước bước deploy bằng ví 37.

## Kiểm thử đã chạy

- Compile bằng AssemblyScript 0.28.20, as-bignum 0.3.1, assemblyscript-json 1.1.0; lockfile đi kèm.
- 9 test chạy **binary WASM thật** với host/token giả lập, fresh instance mỗi call, 100 vòng nạp/rút.
- Kiểm tra quyền init, init lặp, token hash sai, RTM đính kèm, approve chưa ghi có, hai ví độc lập, admin không rút hộ, rút lặp, token trap/error/malformed/tax, callback tái nhập, pause cho rút, donation không tạo credit, cap ví/tổng 10 ví, số atomic sai và thiếu allowance.
- 17 test mô hình/app cũ tiếp tục pass; TypeScript, lint, production build kiểm tra riêng.
- Runtime test mô phỏng rollback bằng snapshot: **không thay thế kiểm thử VM Retium/testnet**. Chưa kiểm fuel/gas, deploy validation hay HardFinal trên chain.
- RTD balance reply được hỗ trợ ở dạng số nguyên bare hoặc JSON string. Transfer reply được hỗ trợ là `true` hoặc object `ok:true` không có error; định dạng khác fail closed. Phải xác nhận token thực tế. Chênh lệch số dư hai phía phải đúng tuyệt đối.
- Mọi refusal đều trap để caller không thể nuốt error sau mutation. Trap không mang thông báo lỗi chi tiết; setup UI sau này phải precheck và phân biệt bước lỗi.

## Build lại (không cần cho preflight)

```powershell
cd "D:\Projects\Retium\retium-perps\contracts\custody"
npm ci
npm run build
npm test
```

`npm test` cấp app chưa tự chạy bộ WASM trong thư mục này. Cần chạy riêng như trên.

## Method đã thực sự viết

| Method | Args | Quyền |
|---|---|---|
| market | [] | đọc |
| account | [walletAddress] | đọc |
| init | [] | chỉ ví 37, một lần, kiểm code hash |
| set_paused | ["true" hoặc "false"] | chỉ ví 37 sau init |
| deposit | [amountAtomic] | ví gọi; cần approve token trước |
| withdraw | [amountAtomic] | số dư của ví gọi; trả về đúng ví gọi |

Chưa có contract ID: không gọi các method ghi cho tới khi deploy thành công, kiểm WASM/code hash và xác nhận init. Dry-run CLI cần signer để tính ID; không dùng ngẫu nhiên file `.sk` cũ nếu không khớp ví 37.

## Tiêu chí tiếp theo

1. Preflight khớp candidate token. Xác nhận nguồn official và chain hiện tại.
2. Dry-run/kiểm điểm weight tại node, deploy đúng WASM bằng ví 37, đợi HardFinal + exec_status ok, đối chiếu onchain code hash với WASM và đọc market.
3. Init đúng owner, vẫn paused; sau đó chủ động unpause cho probe.
4. Approve đúng 0.001 RTD, deposit 0.001, withdraw 0.001; đối chiếu độc lập balances, liabilities, events và kết quả thực thi. Approve không phải deposit.
5. Hai ví thử phân quyền. Chưa công khai nạp vốn; phải kiểm runtime rollback/fuel và các trường hợp lỗi bằng VM thích hợp.
6. Sau custody mới thiết kế vị thế/pool/nguồn giá xác minh được. Không tái sử dụng giá BTC nhập tay hoặc Safehouse 1:1 làm oracle BTC.

## Nguồn đối chiếu

- https://docs.retium.org/developers/tokens
- https://docs.retium.org/developers/writing-contracts
- https://github.com/Retium-Org/retium-sdk (đã đối chiếu bản 09f27815236946d67a9be5984504a5bcdf8cb7cd)

Host ABI/memoryBase theo ví dụ AssemblyScript SDK; JSON và bignum theo dependency license. Xem THIRD_PARTY.md.
