#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive
echo "========== [1/7] 系统更新 + 基础工具 =========="
apt-get update -y -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl wget git unzip zip jq htop tmux ca-certificates gnupg build-essential

echo "========== [2/7] 安装 Node.js 22 LTS =========="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs
fi
echo "node: $(node -v)  npm: $(npm -v)"

echo "========== [3/7] 安装 Codex CLI =========="
npm install -g @openai/codex 2>&1 | tail -3
echo "codex: $(command -v codex && codex --version 2>/dev/null || echo 'installed')"

echo "========== [4/7] 安装 Claude Code CLI =========="
npm install -g @anthropic-ai/claude-code 2>&1 | tail -3
echo "claude: $(command -v claude || echo 'installed')"

echo "========== [5/7] 安装 Python3 + pip + venv =========="
apt-get install -y -qq python3 python3-pip python3-venv python3-full
echo "python: $(python3 --version)  pip: $(pip3 --version 2>/dev/null | head -1)"

echo "========== [6/7] 系统调优 + 安全加固 =========="
timedatectl set-timezone Asia/Singapore 2>/dev/null || ln -sf /usr/share/zoneinfo/Asia/Singapore /etc/localtime
# 增大 swap 已默认 5G，调整 swappiness
sysctl -w vm.swappiness=10 >/dev/null
grep -q "vm.swappiness" /etc/sysctl.conf || echo "vm.swappiness=10" >> /etc/sysctl.conf
# UFW 防火墙
apt-get install -y -qq ufw >/dev/null 2>&1
ufw --force enable >/dev/null 2>&1
ufw allow 22/tcp >/dev/null 2>&1
echo "timezone: $(timedatectl | grep 'Time zone' || date)"
echo "ufw: $(ufw status | head -1)"

echo "========== [7/7] 环境汇总 =========="
echo "--- 版本信息 ---"
echo "OS      : $(. /etc/os-release; echo $PRETTY_NAME)"
echo "Kernel  : $(uname -r)"
echo "CPU     : $(nproc) 核"
echo "RAM     : $(free -h | awk '/Mem:/{print $2}')"
echo "Disk    : $(df -h / | awk 'NR==2{print $2" 总 / "$4" 可用"}')"
echo "Node    : $(node -v 2>/dev/null || echo '未装')"
echo "npm     : $(npm -v 2>/dev/null || echo '未装')"
echo "Codex   : $(npm list -g @openai/codex --depth=0 2>/dev/null | grep codex || echo '检查中')"
echo "Claude  : $(npm list -g @anthropic-ai/claude-code --depth=0 2>/dev/null | grep claude || echo '检查中')"
echo "Python  : $(python3 --version 2>/dev/null || echo '未装')"
echo "Git     : $(git --version 2>/dev/null || echo '未装')"
echo "====== 安装完成 ======"
