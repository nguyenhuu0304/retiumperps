# Retium Perps — bước 2: đặc tả thực thi quỹ ký quỹ

Đây là mô hình TypeScript dùng để kiểm thử trước khi viết/biên dịch contract Retium. KHÔNG phải smart contract, không có WASM, không gửi giao dịch, chưa chứng minh tính nguyên tử của VM trên chain. Giao diện sandbox giữ nguyên.

## Kết quả kiểm tra

17 test pass: 9 nhóm sandbox hiện có và 8 nhóm custody mới. Hai bài thử mỗi bài 1.000 bước kiểm tra bảo toàn sổ cái. TypeScript, lint và production build cũng được kiểm tra riêng.

- Init chỉ ví quản trị đã cấu hình; không cho người gọi đầu tiên tùy ý chiếm owner.
- Token phải khớp contract ID và code hash đã ghim; symbol không đủ.
- Approve không ghi tăng số dư ký quỹ. Chỉ ghi có sau transfer_from và kiểm tra chênh lệch số dư chính xác ở cả hai bên.
- Tách số dư của Alice/Bob; admin không có chức năng rút hộ/sweep.
- Lỗi token, reply không đúng định dạng hoặc token thu phí phải rollback cả sổ cái và token/allowance trong mô hình.
- Payout thất bại giữ nguyên quyền rút. Một khoản không thể rút hai lần.
- Chặn callback tái nhập cả deposit và withdraw.
- Pause chặn nạp mới nhưng không khóa rút tiền rảnh.

Mô hình chỉ có tiền rảnh, CHƯA khóa margin vào vị thế và CHƯA xử lý PnL. Quy tắc rút này không được đem dùng nguyên xi cho margin đang đảm bảo vị thế.

## Giao diện contract dự kiến (chưa tồn tại trên chain)

| Method | Đối số | Điều kiện |
|---|---|---|
| init | cấu hình đã cam kết lúc build | đúng initializer; một lần |
| deposit | amountAtomic | token/code hash đúng; pull đủ; ghi có đúng caller |
| withdraw | amountAtomic | chỉ tiền rảnh của caller; trả đúng caller |
| set_paused | boolean | owner; không ngăn rút tiền rảnh |
| account | address | chỉ đọc |
| market | không | chỉ đọc, hiển thị cấu hình và trạng thái |

Không chạy `retium call` với các method này: hiện chưa deploy contract Perps.

## Điều kiện trước bước onchain

1. Port mô hình sang Retium contract, checked arithmetic, bảo vệ initializer và định danh tài sản; biên dịch WASM và dry-run. Hiện chưa làm bước này; môi trường xây bản này không có cargo/rustc.
2. Dùng runtime VM kiểm tra cross-contract error/trap và rollback cả token, allowance, storage. `checkpoint/rollback` trong test là giả lập yêu cầu, không phải bằng chứng chain đảm bảo.
3. Xác nhận định dạng reply thật của RTD: mô hình hiện đòi object `{ok:true}`; adapter phải được kiểm tra với source/VM/token thật trước khi dùng. Chưa xác nhận lại RTD trên mạng hiện tại.
4. Thử approve -> deposit nhỏ -> withdraw toàn bộ trên testnet, đối chiếu balances và HardFinal + exec_status ok độc lập.
5. Sau custody mới nối lock margin, pool liability reservation, quote authentication, execution expiry/cancel, liquidation. Giá BTC nhập tay và Safehouse 1:1 không được dùng làm oracle BTC cho tiền onchain.
6. Chọn nguồn giá có thể xác minh trong contract; kiểm tra replay, chain/market domain, timestamp, giới hạn lệch giá và chính sách khi oracle dừng. Chưa xác nhận native oracle triển khai trên Retium.

Không yêu cầu người dùng gửi seed, API key hay file .sk. Không dùng DB/worker/contract của Retium Pay.

## Chạy trên PowerShell

```powershell
cd "D:\Projects\Retium\retium-perps"
npm test
npm run typecheck
npm run lint
npm run build
```

Nếu chỉ muốn kiểm tra custody: `node --experimental-strip-types --test tests/custody.test.mjs`.
