#!/bin/bash
# Script cập nhật Firefox Extension từ mã nguồn
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "Đang nén extension thành file query_tool.xpi..."
zip -r -FS query_tool.xpi manifest.json background.js content.js ui.html ui.js sites_data.json sql-formatter.min.js sweetalert2.all.min.js bootstrap.bundle.min.js xlsx.full.min.js icon_red.png vs/ -x "*.rar"

for p in ~/.mozilla/firefox-esr/*/ ~/.mozilla/firefox/*/; do
  if [ -d "$p" ]; then
    mkdir -p "$p/extensions/"
    cp query_tool.xpi "$p/extensions/vnpthis-sql-query-tool@project.com.xpi"
  fi
done

if [ -d /usr/lib/firefox-esr/distribution/extensions/ ]; then
    sudo cp query_tool.xpi /usr/lib/firefox-esr/distribution/extensions/vnpthis-sql-query-tool@project.com.xpi 2>/dev/null || true
fi

echo "Hoàn tất! Hãy khởi động lại hoặc reload Firefox để áp dụng thay đổi."
