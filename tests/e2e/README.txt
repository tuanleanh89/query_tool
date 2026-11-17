# E2E giả lập (Chrome headless + chrome.storage giả + Monaco giả)
node tests/e2e/server.js &   # cổng 8099, phục vụ code/ (sửa đường dẫn root trong server.js nếu cần)
node tests/e2e/t4.js        # đổi site nhiều lần + mở lại: phiên/tab phải còn nguyên
