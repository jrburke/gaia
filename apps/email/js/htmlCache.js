/*global document, console, setTimeout, define: true */

define(['exports'], function (exports) {

/**
 * Version number for cache, allows expiring
 */
var CACHE_VERSION = '1';

/**
 * Saves a JS object to document.cookie using JSON.stringify().
 * This method claims all cookie keys that have pattern
 * /htmlc(\d+)/
 */
exports.save = function htmlCacheSave(html) {
  html = encodeURIComponent(CACHE_VERSION + ':' + html);

  // Set to 20 years from now.
  var expiry = Date.now() + (20 * 365 * 24 * 60 * 60 * 1000);
  expiry = (new Date(expiry)).toUTCString();

  // Split string into segments.
  var index = 0;
  var endPoint = 0;
  var length = html.length;

  for (var i = 0; i < length; i = endPoint, index += 1) {
    // Max per-cookie length is around 4097 bytes for firefox.
    // Give some space for key and allow i18n chars, which may
    // take two bytes, end up with 2030. This page used
    // to test cookie limits: http://browsercookielimits.x64.me/
    endPoint = 2030 + i;
    if (endPoint > length) {
      endPoint = length;
    }

    document.cookie = 'htmlc' + index + '=' + html.substring(i, endPoint) +
                      '; expires=' + expiry;
  }

  // If previous cookie was bigger, clear out the other values,
  // to make sure they do not interfere later when reading and
  // reassembling. If the cache saved is too big, just clear it as
  // there will likely be cache corruption/partial, bad HTML saved
  // otherwise.
  var maxSegment = 40;
  if (index > 39) {
    index = 0;
    console.log('htmlCache.save TOO BIG. Removing all of it.');
  }
  for (i = index; i < maxSegment; i++) {
    document.cookie = 'htmlc' + i + '=; expires=' + expiry;
  }

  console.log('htmlCache.save: ' + html.length + ' in ' +
              (index) + ' segments');
};

/**
 * setTimeout ID used to track delayed save.
 */
var delayedSaveId = 0;

/**
 * HTML string to save on a delayed save.
 */
var delayedHtml = '';

exports.delayedSaveFromNode = function delayedSaveFromNode(node) {
  delayedHtml = node.outerHTML;
  if (!delayedSaveId) {
    setTimeout(function () {
      delayedSaveId = 0;
      exports.save(delayedHtml);
    }, 500);
  }
};

});
