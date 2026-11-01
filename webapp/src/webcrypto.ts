/* eslint-disable global-require */
import {isNode} from './utils';

// Use the same standard WebCrypto API in browsers and modern Node test runs.
const webcrypto: Crypto = isNode ? require('crypto').webcrypto : window.crypto;
export {webcrypto};
