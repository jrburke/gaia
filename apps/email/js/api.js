
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
    return acctSlice;
  }
};

apiLocal.hasAccounts = (document.cookie || '')
                       .indexOf('mailHasAccounts') !== -1;

function MailAPI() {
  return apiLocal;
}

MailAPI.load = function (id, require, onload, config) {
  if (config.isBuild || !apiLocal._fake)
    return onload(apiLocal);

  function onMailAPI(event) {
    window.removeEventListener('mailapi', onMailAPI, false);
    console.log('got MailAPI FOR REALZ!');
    require(['l10n'], function (mozL10n) {
      apiLocal = event.mailAPI;
      apiLocal.useLocalizedStrings({
        wrote: mozL10n.get('reply-quoting-wrote'),
        originalMessage: mozL10n.get('forward-original-message'),
        forwardHeaderLabels: {
          subject: mozL10n.get('forward-header-subject'),
          date: mozL10n.get('forward-header-date'),
          from: mozL10n.get('forward-header-from'),
          replyTo: mozL10n.get('forward-header-reply-to'),
          to: mozL10n.get('forward-header-to'),
          cc: mozL10n.get('forward-header-cc')
        },
        folderNames: {
          inbox: mozL10n.get('folder-inbox'),
          sent: mozL10n.get('folder-sent'),
          drafts: mozL10n.get('folder-drafts'),
          trash: mozL10n.get('folder-trash'),
          queue: mozL10n.get('folder-queue'),
          junk: mozL10n.get('folder-junk'),
          archives: mozL10n.get('folder-archives'),
          localdrafts: mozL10n.get('folder-localdrafts')
        }
      });
      onload(apiLocal);
    });
  }
  window.addEventListener('mailapi', onMailAPI, false);

  setTimeout(function () {
    require(['mailapi/main-frame-setup']);
  }, 3000);
};


return MailAPI;

});
