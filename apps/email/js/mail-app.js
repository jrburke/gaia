/**
 * Application logic that isn't specific to cards, specifically entailing
 * startup and eventually notifications.
 **/

/*jshint browser: true */
/*global define, require, console, confirm */

 setTimeout(function () {
  var prop,
      t = performance.timing,
      start = t.fetchStart,
      text = '';
  for (prop in t) {
    text += prop + ': ' + (t[prop] - start) + '\n';
  }

  text += '\n\nSCRIPT LIST:';
  [].slice.call(document.querySelectorAll('script'), 0).forEach(function (node) {
    text += '\n' + node.src;
  });
  console.log(text);
 }, 10000);


// set up loading of scripts.
require.config({
  baseUrl: 'js',
  paths: {
    jslocales: '../jslocales',
    l10nbase: '../../../shared/js/l10n',
    l10ndate: '../../../shared/js/l10n_date',
    style: '../style',
    shared: '../../../shared',

    mailapi: 'ext/mailapi',
    mimelib: 'ext/mimelib',

    // mailcomposer is in the mailapi/composer layer.
    mailcomposer: 'ext/mailapi/composer',

    // Point activesync protocol modules to their layer
    'wbxml': 'ext/mailapi/activesync/protocollayer',
    'activesync/codepages': 'ext/mailapi/activesync/protocollayer',
    'activesync/protocol': 'ext/mailapi/activesync/protocollayer',

    // activesync/codepages is split across two layers. If
    // activesync/protocol loads first (for autoconfig work on account setup),
    // then indicate the parts of codepages that are in activesync/configurator
    'activesync/codepages/FolderHierarchy':
                                      'ext/mailapi/activesync/configurator',
    'activesync/codepages/ComposeMail':
                                      'ext/mailapi/activesync/configurator',
    'activesync/codepages/AirSync':
                                      'ext/mailapi/activesync/configurator',
    'activesync/codepages/AirSyncBase':
                                      'ext/mailapi/activesync/configurator',
    'activesync/codepages/ItemEstimate':
                                      'ext/mailapi/activesync/configurator',
    'activesync/codepages/Email':
                                      'ext/mailapi/activesync/configurator',
    'activesync/codepages/ItemOperations':
                                      'ext/mailapi/activesync/configurator',
    'activesync/codepages/Move':
                                      'ext/mailapi/activesync/configurator',

    // Point chew methods to the chew layer
    'mailapi/htmlchew': 'ext/mailapi/chewlayer',
    'mailapi/quotechew': 'ext/mailapi/chewlayer',
    'mailapi/imap/imapchew': 'ext/mailapi/chewlayer',

    // Imap body fetching / parsing / sync
    'mailapi/imap/protocol/sync': 'ext/mailapi/imap/protocollayer',
    'mailapi/imap/protocol/textparser': 'ext/mailapi/imap/protocollayer',
    'mailapi/imap/protocol/snippetparser': 'ext/mailapi/imap/protocollayer',
    'mailapi/imap/protocol/bodyfetcher': 'ext/mailapi/imap/protocollayer',

    // The imap probe layer also contains the imap module
    'imap': 'ext/mailapi/imap/probe',

    // The smtp probe layer also contains the simpleclient
    'simplesmtp/lib/client': 'ext/mailapi/smtp/probe'
  },
  shim: {
    l10ndate: ['l10nbase']
  },
  scriptType: 'application/javascript;version=1.8',
  definePrim: 'prim'
});

// Named module, so it is the same before and after build.
define('mail-app', [
  'require',
  'mail-common',
  'api'
],
function (require, common, MailAPI) {

//console.log('@@@@mail-api START: ' + (performance.now() - _xstart));


var Cards = common.Cards,
    isFirstCard = true,
    activityCallback = null;

var App = {
  initialized: false,

  /**
   * Bind any global notifications, relay localizations to the back-end.
   */
  _init: function() {
    // If our password is bad, we need to pop up a card to ask for the updated
    // password.
    if (!MailAPI()._fake) {
      MailAPI().onbadlogin = function(account, problem) {
        switch (problem) {
          case 'bad-user-or-pass':
            Cards.pushCard('setup-fix-password', 'default', 'animate',
                      { account: account, restoreCard: Cards.activeCardIndex },
                      'right');
            break;
          case 'imap-disabled':
            Cards.pushCard('setup-fix-gmail-imap', 'default', 'animate',
                      { account: account, restoreCard: Cards.activeCardIndex },
                      'right');
            break;
          case 'needs-app-pass':
            Cards.pushCard('setup-fix-gmail-twofactor', 'default', 'animate',
                      { account: account, restoreCard: Cards.activeCardIndex },
                      'right');
            break;
        }
      };
    }
    this.initialized = true;
  },

  /**
   * Show the best inbox we have (unified if >1 account, just the inbox if 1) or
   * start the setup process if we have no accounts.
   */
  showMessageViewOrSetup: function(showLatest) {
    // Get the list of accounts including the unified account (if it exists)
    var acctsSlice = MailAPI().viewAccounts(false);
    acctsSlice.oncomplete = function() {
//      console.log('@@@@acctsSlice.oncomplete: ' + (performance.now() - _xstart));
      // - we have accounts, show the message view!
      if (acctsSlice.items.length && !MailAPI()._fake) {
        // For now, just use the first one; we do attempt to put unified first
        // so this should generally do the right thing.
        // XXX: Because we don't have unified account now, we should switch to
        //       the latest account which user just added.
        var account = showLatest ? acctsSlice.items.slice(-1)[0] :
                                   acctsSlice.items[0];
        var foldersSlice = MailAPI().viewFolders('account', account);
        foldersSlice.oncomplete = function() {
          var inboxFolder = foldersSlice.getFirstFolderWithType('inbox');
          if (!inboxFolder)
            common.dieOnFatalError('We have an account without an inbox!',
                foldersSlice.items);

          // Find out if a blank message-list card was already inserted, and
          // if so, then just reuse it.
          var hasMessageListCard = Cards.hasCard(['message-list', 'nonsearch']);

          if (hasMessageListCard) {
            // Just update existing card
            Cards.tellCard(
              ['message-list', 'nonsearch'],
              { folder: inboxFolder }
            );
          } else {
            // Clear out old cards, start fresh. This can happen for
            // an incorrect fast path guess, and likely to happen for
            // email apps that get upgraded from a version that did
            // not have the cookie fast path.
            Cards.removeAllCards();

            // Push the message list card
            Cards.pushCard(
              'message-list', 'nonsearch', 'immediate',
              {
                folder: inboxFolder
              });
          }

          // Add navigation, but before the message list.
          Cards.pushCard(
            'folder-picker', 'navigation', 'none',
            {
              acctsSlice: acctsSlice,
              curAccount: account,
              foldersSlice: foldersSlice,
              curFolder: inboxFolder
            },
            // Place to left of message list
            'left');

          if (activityCallback) {
            activityCallback();
            activityCallback = null;
          }
        };
      } else if (MailAPI()._fake && MailAPI().hasAccounts) {
        // Insert a fake card while loading finishes.
        Cards.assertNoCards();
        Cards.pushCard(
          'message-list', 'nonsearch', 'immediate',
          { folder: null }
        );
      }
      // - no accounts, show the setup page!
      else if (!Cards.hasCard(['setup-account-info', 'default'])) {
//console.log('@@@@setup-account-info start: ' + (performance.now() - _xstart));
        acctsSlice.die();
        if (activityCallback) {
          // Clear out activity callback, but do it
          // before calling activityCallback, in
          // case that code then needs to set a delayed
          // activityCallback for later.
          var activityCb = activityCallback;
          activityCallback = null;
          var result = activityCb();
          if (!result)
            return;
        }

        // Could have bad state from an incorrect _fake fast path.
        // Mostly likely when the email app is updated from one that
        // did not have the fast path cookies set up.
        Cards.removeAllCards();

        if (isFirstCard) {
          Cards.sendAppRendered = true;
        }
//console.log('@@@@ABOUT TO PUSHCARD: ' + (performance.now() - _xstart));
        Cards.pushCard(
          'setup-account-info', 'default', 'immediate',
          {
            allowBack: false
          });
//console.log('@@@@PUSHCARD FINISHED: ' + (performance.now() - _xstart));
      }

      isFirstCard = false;

      if (MailAPI()._fake) {
        require(['api!real'], function (api) {
          doInit();
        });
      }
    };

    // If fake API, kick the oncomplete manually, synchronously here, instead
    // of waiting for the event loop to get back to us, since the browser
    // likely has some things that may take some time in the event loop before
    // getting back to us.
    if (MailAPI()._fake) {
      acctsSlice.oncomplete();
    }
  }
};

var queryURI = function _queryURI(uri) {
  function addressesToArray(addresses) {
    if (!addresses)
      return [''];
    addresses = addresses.split(';');
    var addressesArray = addresses.filter(function notEmpty(addr) {
      return addr.trim() !== '';
    });
    return addressesArray;
  }
  var mailtoReg = /^mailto:(.*)/i;

  if (uri.match(mailtoReg)) {
    uri = uri.match(mailtoReg)[1];
    var parts = uri.split('?');
    var subjectReg = /(?:^|&)subject=([^\&]*)/i,
    bodyReg = /(?:^|&)body=([^\&]*)/i,
    ccReg = /(?:^|&)cc=([^\&]*)/i,
    bccReg = /(?:^|&)bcc=([^\&]*)/i;
    var to = addressesToArray(decodeURIComponent(parts[0])),
    subject,
    body,
    cc,
    bcc;

    if (parts.length == 2) {
      var data = parts[1];
      if (data.match(subjectReg))
        subject = decodeURIComponent(data.match(subjectReg)[1]);
      if (data.match(bodyReg))
        body = decodeURIComponent(data.match(bodyReg)[1]);
      if (data.match(ccReg))
        cc = addressesToArray(decodeURIComponent(data.match(ccReg)[1]));
      if (parts[1].match(bccReg))
        bcc = addressesToArray(decodeURIComponent(data.match(bccReg)[1]));
    }
      return [to, subject, body, cc, bcc];

  }

};


var inited = false;

function doInit() {
  try {
    if (inited) {
      if (!MailAPI()._fake) {
        // Real MailAPI set up now. We could have guessed wrong
        // for the fast path, particularly if this is an email
        // app upgrade, where they set up an account, but our
        // fast path for no account setup was not in place then.
        App._init();
        App.showMessageViewOrSetup();
      }
    } else {
//console.log('@@@@Doing an init: ' + (performance.now() - _xstart));

      inited = true;
      Cards._init();
      App._init();
      App.showMessageViewOrSetup();
    }
  } catch (ex) {
    console.error('Problem initializing', ex, '\n', ex.stack);
  }
}

doInit();

if ('mozSetMessageHandler' in window.navigator) {
  window.navigator.mozSetMessageHandler('activity',
                                        function actHandle(activity) {
    var activityName = activity.source.name;
    // To assist in bug analysis, log the start of the activity here.
    console.log('activity!', activityName);
    if (activityName === 'share') {
      var attachmentBlobs = activity.source.data.blobs,
          attachmentNames = activity.source.data.filenames;
    }
    else if (activityName === 'new' ||
             activityName === 'view') {
      // new uses URI, view uses url
      var parts = queryURI(activity.source.data.url ||
                           activity.source.data.URI);
      var to = parts[0];
      var subject = parts[1];
      var body = parts[2];
      var cc = parts[3];
      var bcc = parts[4];
    }
    var sendMail = function actHandleMail() {
      var folderToUse;
      try {
        folderToUse = Cards._cardStack[Cards
          ._findCard(['folder-picker', 'navigation'])].cardImpl.curFolder;
      } catch (e) {
        console.log('no navigation found:', e);
        var req = confirm(mozL10n.get('setup-empty-account-prompt'));
        if (!req) {
          // We want to do the right thing, but currently this won't even dump
          // us in the home-screen app.  This is because our activity has
          // disposition: window rather than inline.
          activity.postError('cancelled');
          // So our workaround is to close our window.
          window.close();
          return false;
        }
        activityCallback = sendMail;
        return true;
      }
      var composer = MailAPI().beginMessageComposition(
        null, folderToUse, null,
        function() {
          /* to/cc/bcc/subject/body all have default values that shouldn't be
          clobbered if they are not specified in the URI*/
          if (to)
            composer.to = to;
          if (subject)
            composer.subject = subject;
          if (body && typeof body === 'string')
            composer.body = { text: body };
          if (cc)
            composer.cc = cc;
          if (bcc)
            composer.bcc = bcc;
          if (attachmentBlobs) {
            for (var iBlob = 0; iBlob < attachmentBlobs.length; iBlob++) {
              composer.addAttachment({
                name: attachmentNames[iBlob],
                blob: attachmentBlobs[iBlob]
              });
            }
          }
          Cards.pushCard('compose',
            'default', 'immediate', { composer: composer,
            activity: activity });
          activityLock = false;
        });
    };

    if (MailAPI && !MailAPI()._fake) {
      console.log('activity', activityName, 'triggering compose now');
      sendMail();
    } else {
      console.log('activity', activityName, 'waiting for callback');
      activityCallback = sendMail;
    }
  });
}
else {
  console.warn('Activity support disabled!');
}

return App;

});

// Run the app module, bring in fancy logging
//console.log('@@@@ABOUT TO REQUIRE: ' + (performance.now() - _xstart));
require(['console-hook', 'mail-app'], null, null, null, true);
