#!/bin/bash
# 给 Ubuntu 服务器装轻量图形桌面 (XFCE) + 远程桌面 (XRDP)
set -e
export DEBIAN_FRONTEND=noninteractive

echo "===== [1/5] 更新软件源 ====="
apt-get update -qq

echo "===== [2/5] 安装 XFCE 轻量桌面 ====="
# --no-install-recommends 省内存，只装核心
apt-get install -y -qq --no-install-recommends \
  xfce4 xfce4-terminal xfce4-goodies \
  dbus-x11 x11-xserver-utils fonts-noto-cjk

echo "===== [3/5] 安装 XRDP 远程桌面服务 ====="
apt-get install -y -qq xrdp

echo "===== [4/5] 配置 XRDP 使用 XFCE ====="
# 让 root 也能通过 xrdp 登录
echo "xfce4-session" > /root/.xsession
chmod +x /root/.xsession

# 配置 xrdp 启动 XFCE
cat > /etc/xrdp/startwm.sh <<'WMEOF'
#!/bin/sh
if [ -r /etc/default/locale ]; then
  . /etc/default/locale
  export LANG LANGUAGE
fi
export XDG_SESSION_TYPE=x11
export XDG_CURRENT_DESKTOP=XFCE
startxfce4
WMEOF
chmod 755 /etc/xrdp/startwm.sh

# 允许 root 远程登录 xrdp（Ubuntu 默认禁止）
sed -i 's/^#*AllowRootLogin.*/AllowRootLogin=true/' /etc/xrdp/sesman.ini 2>/dev/null || true
grep -q "^AllowRootLogin" /etc/xrdp/sesman.ini || sed -i '/\[Globals\]/a AllowRootLogin=true' /etc/xrdp/sesman.ini

# 关掉 xrdp 的 SSL 证书报错（自签证书，用低加密级别避免连接失败）
sed -i 's/^#*crypt_level=.*/crypt_level=low/' /etc/xrdp/xrdp.ini 2>/dev/null || true
grep -q "^crypt_level" /etc/xrdp/xrdp.ini || sed -i '/^\[globals\]/a crypt_level=low' /etc/xrdp/xrdp.ini

echo "===== [5/5] 启动服务 + 放行端口 ====="
adduser xrdp ssl-cert 2>/dev/null || true
systemctl enable xrdp >/dev/null 2>&1
systemctl restart xrdp
systemctl restart xrdp-sesman 2>/dev/null || true

ufw allow 3389/tcp >/dev/null 2>&1 || true

echo "----- 服务状态 -----"
systemctl is-active xrdp && echo "xrdp: 运行中" || echo "xrdp: 未运行"
echo "----- 监听端口 -----"
ss -tlnp 2>/dev/null | grep -E "3389|:22 " || netstat -tlnp 2>/dev/null | grep -E "3389|:22 "
echo "===== 安装完成 ====="
