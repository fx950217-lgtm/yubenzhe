/** Account credentials only. Local wallet encryption keeps its independent policy. */
export function isCurrentAccountPassword(value) {
  return typeof value === 'string' && (/^\d{6}$/.test(value) || value.length >= 12 && value.length <= 128 && !!value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
}
export function validateNewAccountPassword(value, capabilities) {
  if (capabilities?.passwordRegistration === true) {
    if (typeof value !== 'string' || value.length < 12 || value.length > 128 || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw Error('账号密码需要 12–128 个字符，不能全为空格或包含控制字符。');
  } else if (!/^\d{6}$/.test(value ?? '')) throw Error('请输入 6 位数字新密码。');
  return value;
}
export function accountPasswordAttributes(capabilities, current = false) {
  if (current) return 'minlength="6" maxlength="128" autocomplete="current-password"';
  return capabilities?.passwordRegistration === true ? 'minlength="12" maxlength="128" autocomplete="new-password"' : 'inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password"';
}
