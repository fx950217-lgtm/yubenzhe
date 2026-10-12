export {mountAccessSecurity as mountAccountSecurity} from './account-access-ui.js';
import {validateNewAccountPassword} from './account-password.js';
export async function recoverAccount(client,{userId,recoveryCode,newPassword,repeat,capabilities}){
 if(!/^[A-Za-z0-9_]{5,24}$/.test(userId?.trim()??''))throw new Error('请输入 5–24 位字母、数字或下划线 ID。');
 validateNewAccountPassword(newPassword,capabilities);
 if(newPassword!==repeat)throw new Error('两次输入的新密码不一致。');
 if(typeof recoveryCode!=='string'||!recoveryCode.trim())throw new Error('请输入此前保存的账号恢复码。');
 return client.publicRequest('security/recover',{method:'POST',input:{userId:userId.trim().toLowerCase(),recoveryCode:recoveryCode.trim(),newPassword}});
}
