const path = require('path');
const request = require('../utils/request');
const protobuf = require('protobufjs');
const Long = require('long');
const { waitFor } = require('../utils/timeout');
const fcmKey = require('../fcm/server-key');
const { toBase64 } = require('../utils/base64');

// Hack to fix PHONE_REGISTRATION_ERROR #17 when bundled with webpack
// https://github.com/dcodeIO/protobuf.js#browserify-integration
protobuf.util.Long = Long
protobuf.configure()

const serverKey = toBase64(Buffer.from(fcmKey));

const REGISTER_URL = 'https://android.clients.google.com/c2dm/register3';
const CHECKIN_URL = 'https://android.clients.google.com/checkin';

let root;
let AndroidCheckinResponse;

module.exports = {
  register,
  checkIn,
};

async function register(appId, config) {
  const options = await checkIn();
  const credentials = await doRegister(options, appId, config);
  return credentials;
}

async function checkIn(androidId, securityToken) {
  await loadProtoFile();
  const buffer = getCheckinRequest(androidId, securityToken);
  const body = await request({
    url     : CHECKIN_URL,
    method  : 'POST',
    headers : {
      'Content-Type' : 'application/x-protobuf',
    },
    body     : buffer,
    encoding : null,
  });
  const message = AndroidCheckinResponse.decode(body);
  const object = AndroidCheckinResponse.toObject(message, {
    longs : String,
    enums : String,
    bytes : String,
  });
  return object;
}

async function doRegister({ androidId, securityToken }, appId, config = {}) {
  const pkg = config.packageName || 'org.chromium.linux';
  const senderId = config.senderId || serverKey;
  const certSha1 = config.certSha1 || '';
  const gmpAppId = config.gmpAppId || '';
  const appVer = config.appVer || '';
  const fisAuthToken = config.fisAuthToken || '';
  const fid = config.fid || '';

  const body = {
    app         : pkg,
    'X-subtype' : senderId,
    device      : androidId,
    sender      : senderId,
  };

  if (certSha1) body.cert = certSha1;
  if (gmpAppId) body['X-gmp_app_id'] = gmpAppId;
  if (appVer) body['X-app_ver'] = appVer;
  if (fid) body['X-appid'] = fid;
  if (fisAuthToken) body['X-Goog-Firebase-Installations-Auth'] = fisAuthToken;

  body['X-osv'] = '34';
  body['X-cliv'] = 'fcm-23.4.1';
  body['X-gmsv'] = '234431044';
  body['X-scope'] = '*';
  body['gcm_ver'] = '234431044';

  const response = await postRegister({ androidId, securityToken, body });
  const token = response.split('=')[1];
  return {
    token,
    androidId,
    securityToken,
    appId : senderId,
  };
}

async function postRegister({ androidId, securityToken, body, retry = 0 }) {
  const response = await request({
    url     : REGISTER_URL,
    method  : 'POST',
    headers : {
      Authorization  : `AidLogin ${androidId}:${securityToken}`,
      'Content-Type' : 'application/x-www-form-urlencoded',
    },
    form : body,
  });
  if (response.includes('Error')) {
    console.warn(`Register request has failed with ${response}`);
    if (retry >= 5) {
      throw new Error('GCM register has failed');
    }
    console.warn(`Retry... ${retry + 1}`);
    await waitFor(1000);
    return postRegister({ androidId, securityToken, body, retry : retry + 1 });
  }
  return response;
}

async function loadProtoFile() {
  if (root) {
    return;
  }
  root = await protobuf.load(path.join(__dirname, 'checkin.proto'));
  return root;
}

function getCheckinRequest(androidId, securityToken) {
  const AndroidCheckinRequest = root.lookupType(
    'checkin_proto.AndroidCheckinRequest'
  );
  AndroidCheckinResponse = root.lookupType(
    'checkin_proto.AndroidCheckinResponse'
  );
  const payload = {
    userSerialNumber : 0,
    checkin          : {
      type  : 1,  // DEVICE_ANDROID_OS (not 3/Chrome)
      build : {
        fingerprint        : 'google/panther/panther:14/UP1A.231005.007/10754064:user/release-keys',
        hardware           : 'tensor',
        brand              : 'google',
        radio              : '',
        bootloader         : 'slider-1.0-10589371',
        clientId           : 'android-google',
        time               : Date.now(),
        packageVersionCode : 234431044,
        device             : 'panther',
        sdkVersion         : 34,
        model              : 'Pixel 7',
        manufacturer       : 'Google',
        product            : 'panther',
        otaInstalled       : false,
      },
      cellOperator : '45201',
      simOperator  : '45201',
    },
    version       : 3,
    id            : androidId ? Long.fromString(androidId) : undefined,
    securityToken : securityToken
      ? Long.fromString(securityToken, true)
      : undefined,
    locale        : 'vi_VN',
    timeZone      : 'Asia/Ho_Chi_Minh',
    fragment      : 0,
  };
  const errMsg = AndroidCheckinRequest.verify(payload);
  if (errMsg) throw Error(errMsg);
  const message = AndroidCheckinRequest.create(payload);
  return AndroidCheckinRequest.encode(message).finish();
}
