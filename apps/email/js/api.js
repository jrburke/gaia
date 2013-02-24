
/*jshint browser: true */
/*global define */
define(['require'], function (require) {

// Local API objec used by front end. Starts off fake to give to front
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

function loadBackEnd(onload) {
  require(['mailapi/same-frame-setup'], function () {
    // Call function set up by same-frame-setup for getting mail API.
    if (apiLocal._fake) {
      window.gimmeMailAPI(function (api) {
        if (apiLocal._fake) {
          apiLocal = api;
        }
        onload(MailAPI);
      });
    } else {
      onload(MailAPI);
    }
  });
}

return {
  load: function (id, require, onload, config) {
      if (config.isBuild)
          return onload();

    // Trigger module resolution for backend to start.
    // If no accounts, load a fake shim that allows
    // bootstrapping to "Enter account" screen faster.
    if (apiLocal._fake && (id === 'real' ||
        (document.cookie || '').indexOf('mailHasAccounts') !== -1)) {
      loadBackEnd(onload);
    } else {
      // Create global property too, in case app comes
      // up after the event has fired.
      onload(MailAPI);
    }
  }
};

});
