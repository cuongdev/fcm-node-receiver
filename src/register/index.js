const uuidv4 = require('uuid/v4');
const { register: registerGCM } = require('../gcm');
const { installFCM, registerFCM } = require('../fcm');

module.exports = register;

async function register(config) {
  const android = config.android;

  if (android) {
    // Android-style registration: GCM token = FCM token (no web push exchange)
    const senderId = config.firebase.projectID
      ? undefined
      : android.senderId;
    const gcmAppId = android.senderId || config.firebase.projectID;

    // Get FIS auth token for the registration
    const installation = await installFCM(config);

    const gcmConfig = {
      packageName  : android.packageName,
      senderId     : android.senderId,
      certSha1     : android.certSha1 || '',
      gmpAppId     : config.firebase.appID,
      appVer       : android.appVer || '',
      fisAuthToken : installation.authToken.token,
      fid          : installation.fid,
      checkin      : android.checkin,
    };

    const subscription = await registerGCM(android.senderId, gcmConfig);

    return {
      fcm : { token : subscription.token },
      gcm : subscription,
      fis : { fid : installation.fid, authToken : installation.authToken.token },
    };
  }

  // Original Chrome/web push registration
  const appId = `wp:receiver.push.com#${uuidv4()}`;
  const subscription = await registerGCM(appId);
  const installation = await installFCM(config);
  const result = await registerFCM({
    ...config,
    authToken : installation.authToken.token,
    token : subscription.token
  });
  return Object.assign({}, result, { gcm : subscription });
}
