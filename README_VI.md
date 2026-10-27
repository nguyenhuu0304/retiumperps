# Retium Perps v0.1.0 — Sandbox riêng

Dự án mới, độc lập với Retium Pay. Không có script cài vào Retium Pay, không có database, .env, khóa ví, worker, API thanh toán hoặc contract đang dùng của Retium Pay.

## Chạy Windows PowerShell

Giải nén ZIP vào `D:\Projects\Retium\retium-perps` (package.json nằm ngay trong thư mục này).

```powershell
cd "D:\Projects\Retium\retium-perps"
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm run dev
```

Mở http://localhost:3100. Cổng khác Retium Pay (3000). Node.js 24.x.

## Những gì chạy được

- Giao diện Anh / Việt, sáng / tối, responsive.
- Một thị trường giả định BTC/USD, một vị thế mỗi lần, Long / Short 1–3×.
- 1.000 RTD số dư mô phỏng và 100.000 RTD quỹ mô phỏng.
- Giá bắt đầu giả định 100.000 USD; tự nhập giá hoặc thay đổi ±5%, ±10%. Đường giá chỉ là các lần bạn thay đổi kịch bản, không phải lịch sử BTC.
- Kiểm tra rồi xác nhận mở vị thế, thêm ký quỹ, đóng toàn bộ, mô phỏng thanh lý và lịch sử phiên (50 mục).
- Kết nối ví tùy chọn chỉ dùng retium_requestAccounts để đọc địa chỉ chain 3. Không có lệnh ký hoặc gửi giao dịch. Số dư mô phỏng KHÔNG phải số dư ví kết nối.
- Dữ liệu phiên trong bộ nhớ, tải lại hoặc Reset sẽ mất. Chưa dùng localStorage nên không xung đột app khác.

## Quy tắc nghiên cứu — không phải Perps hoàn chỉnh

- Tính tiền bằng BigInt 18 decimals; số trên đồ thị chỉ để vẽ.
- Quy mô vị thế = ký quỹ lúc mở × đòn bẩy. PnL tuyến tính theo tỷ lệ thay đổi giá.
- Lãi bị chặn tại 100% ký quỹ ban đầu, lỗ bị chặn ở ký quỹ hiện tại. Đây là mô hình capped-payout sandbox; không giới thiệu như Perps không giới hạn lãi.
- Thêm ký quỹ KHÔNG tăng quy mô vị thế hay trần lãi.
- Phí mở và đóng đều 0,1% quy mô lúc mở. Phí đóng tối đa bằng vốn còn lại. Quy tắc đơn giản này chưa theo notional lúc đóng như một số sàn.
- Thanh lý khi vốn vị thế <= 5% quy mô lúc mở. Phần còn lại sau phí và thưởng trả về ví mô phỏng. Thưởng keeper mô phỏng tối đa 1% ký quỹ hiện tại và không vượt số còn lại.
- Khi đủ điều kiện thanh lý, dùng nút Mô phỏng thanh lý; không có bot tự chạy.
- Giá quá 30 giây sẽ chặn mở/đóng/thanh lý, phải bấm Làm mới giá thủ công. Đây là bài kiểm thử freshness, không phải oracle thật.
- Không có funding, slippage, gas, spread, limit order, TP/SL, oracle hay thanh khoản thực. Chiến lược bảo vệ khi oracle gián đoạn và thanh toán khẩn cấp còn chưa triển khai.
- Không có contract Rust/WASM và không có giao dịch on-chain. Không gửi tiền vào bất kỳ địa chỉ nào với mục đích nạp Perps này.

## Tự thử

1. Không cần kết nối ví. Giữ ký quỹ 100, đòn bẩy 2×, Long → Kiểm tra → Mở thử nghiệm.
2. Bấm +10% giá. PnL trước phí sẽ là +20 RTD.
3. Đóng vị thế. Tổng phí mở+đóng 0,4 RTD; ví thành 1019,6 RTD.
4. Reset. Mở Long 100 RTD, 2× tại 100.000.
5. Nhập giá 55.000 và Áp dụng. Equity 10 RTD = maintenance; thử Mô phỏng thanh lý.
6. Reset, mở Short và thử giá tăng. Hoặc để quá 30 giây trước khi mở để thấy chặn giá cũ.

## Kiểm tra đã chạy

- 9 nhóm kiểm thử Node pass; bao gồm 1.000 kịch bản xác định kiểm tra bảo toàn tổng tiền, giá cũ/tương lai/lặp, giới hạn số dư, trần lãi, giá gap, thanh lý, đóng lặp và không mutate input.
- TypeScript, ESLint và Next production build pass.
- Kiểm tra HTML production qua HTTP; chưa kiểm tra trực quan bằng trình duyệt thật trong môi trường đóng gói.
- Đây là kiểm thử mô hình JavaScript/TypeScript, KHÔNG phải audit hay test VM Retium.

## Bước sau trước khi on-chain

Đọc RESEARCH.md. Chỉ triển khai contract riêng sau khi chốt mô hình thanh khoản, xác thực oracle và chống chọn giá, funding, xử lý gián đoạn, giới hạn lệnh, chi phí keeper và cơ chế khởi tạo có phân quyền. Không sao chép bí mật Retium Pay sang dự án này.
