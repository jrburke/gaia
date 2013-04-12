
/*jshint browser: true */
/*global define */
define(['require'], function (require) {

// Local API object used by front end. Starts off fake to give to front
// end something quick to use when no accounts.
var apiLocal = {
  _fake: true,
  useLocalizedStrings: function () {},
  viewAccounts: function () {
    var acctSlice = {
      items: [],
      die: function () {}
    };

    setTimeout(function () {
        if (acctSlice.oncomplete) {
          acctSlice.oncomplete();
        }
    }, 0);
    return acctSlice;
  }
};

function MailAPI() {
  return apiLocal;
}

function loadBackEnd() {

  function onMailAPI(event) {
    window.removeEventListener('mailapi', onMailAPI, false);
    console.log('got MailAPI FOR REALZ!');
    apiLocal = event.mailAPI;
  }
  window.addEventListener('mailapi', onMailAPI, false);

  setTimeout(function () {
    require(['mailapi/main-frame-setup'], function () {
    });
  }, 1000);
}

return {
  load: function (id, require, onload, config) {
    if (config.isBuild)
      return onload();

    apiLocal.hasAccounts = (document.cookie || '')
                              .indexOf('mailHasAccounts') !== -1;

    // Trigger module resolution for backend to start.
    // If no accounts, load a fake shim that allows
    // bootstrapping to "Enter account" screen faster.
    if (apiLocal._fake && (id === 'real' || apiLocal.hasAccounts)) {
console.log('??? API: loading back end: ' + MailAPI()._fake + ': ' + (performance.now() - _xstart));
      loadBackEnd(onload);
      onload(MailAPI);
    } else {
      // Create global property too, in case app comes
      // up after the event has fired.
console.log('??? API: going non-back-end: ' + MailAPI()._fake + ': ' + (performance.now() - _xstart));
      onload(MailAPI);
    }
  }
};

});
