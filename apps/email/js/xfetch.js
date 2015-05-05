define(function(require) {
'use strict';

return function xfetch(url, responseType) {
  return new Promise(function(resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = responseType || 'text';
    xhr.onload = function() {
      // blobs currently result in a status of 0 since there is no server.
      if (xhr.status !== 0 && (xhr.status < 200 || xhr.status >= 300)) {
        reject(xhr.status);
        return;
      }
      resolve(xhr.response);
    };
    xhr.onerror = function() {
      reject('error');
    };
    try {
      xhr.send();
    }
    catch(ex) {
      console.error('XHR send() failure on blob');
      reject('exception');
    }
  });
};

});
