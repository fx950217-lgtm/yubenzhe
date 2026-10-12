'use strict';
const path=require('node:path');
function reviewProfilePath(argv,appData){
 if(!argv.includes('--device-review'))return null;
 const entries=argv.filter(value=>value.startsWith('--device-review-id='));
 if(entries.length>1)throw Error('Only one review profile may be selected.');
 if(!entries.length)return path.join(appData,'YBZ Device Installer Review');
 const id=entries[0].slice('--device-review-id='.length);
 if(!/^[a-z0-9][a-z0-9-]{0,47}$/.test(id))throw Error('Invalid review profile ID.');
 return path.join(appData,'YBZ Device Installer Review '+id);
}
module.exports={reviewProfilePath};
