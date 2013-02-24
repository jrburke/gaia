
/*jshint browser: true */
/*global define */
define(['require'], function (require) {

function loadBackEnd(onload) {
  require(['mailapi/same-frame-setup'], function () {
    // Call function set up by same-frame-setup for getting mail API.
    window.gimmeMailAPI(onload);
  });
}

// Fake API to give to front end in the
// case when there are no accounts.
var fake = {
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

return {
  load: function (id, require, onload, config) {
      if (config.isBuild)
          return onload();

    // Trigger module resolution for backend to start.
    // If no accounts, load a fake shim that allows
    // bootstrapping to "Enter account" screen faster.
    if (id === 'real' ||
        (document.cookie || '').indexOf('mailHasAccounts') !== -1) {
      loadBackEnd(onload);
    } else {
      // Create global property too, in case app comes
      // up after the event has fired.
      onload(fake);
    }
  }
};

});
