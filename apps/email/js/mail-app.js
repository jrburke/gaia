/**
 * Application logic that isn't specific to cards, specifically entailing
 * startup and eventually notifications.
 **/

// MailAPI is a global, set up by main-frame-setup.



/**
 * Saves a JS object to document.cookie using JSON.stringify().
 * This method claims all cookie keys that have pattern
 * /cache(\d+)/
 */
function saveHtmlCookieCache() {
  var html = document.getElementById('cards').innerHTML;

  html = encodeURIComponent(html);

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
  // reassembling.
  var maxSegment = 40;
  for (i = index; i < maxSegment; i++) {
    document.cookie = 'htmlc' + i + '=; expires=' + expiry;
  }

  console.log('saveHtmlCacheCookie: ' + html.length + ' in ' +
              (index) + ' segments');
}

/**
 * Gets HTML from document.cookie.
 * This method assumes all cookie keys that have pattern
 * /htmlc(\d+)/ are part of the object value. This method could
 * throw given vagaries of cookie cookie storage and encodings.
 * Be prepared.
 */
function getHtmlCookieCache() {
  var value = document.cookie;
  var pairRegExp = /htmlc(\d+)=([^;]+)/g;
  var segments = [];
  var match;

  while (match = pairRegExp.exec(value)) {
    segments[parseInt(match[1], 10)] = match[2] || '';
  }

  return decodeURIComponent(segments.join(''));
}

(function () {
  var html = getHtmlCookieCache();
  if (html) {
    var node = document.getElementById('cards');
    node.innerHTML = html;
  }
}());

var App = {
  initialized: false,

  loader: LazyLoader,

  /**
   * Preloads all remaining resources
   */
  preloadAll: function(cb) {
    cb = cb || function() {};

    App.loader.load(
      ['style/value_selector.css',
      'style/compose-cards.css',
      'style/setup-cards.css',
      'js/value_selector.js',
      'js/iframe-shims.js',
      'js/setup-cards.js',
      'js/compose-cards.js'],
      cb
    );
  },

  /**
   * Bind any global notifications, relay localizations to the back-end.
   */
  _init: function() {
    // If our password is bad, we need to pop up a card to ask for the updated
    // password.
    MailAPI.onbadlogin = function(account, problem) {
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

    MailAPI.useLocalizedStrings({
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

    this.initialized = true;
  },

  /**
   * Show the best inbox we have (unified if >1 account, just the inbox if 1) or
   * start the setup process if we have no accounts.
   */
  showMessageViewOrSetup: function(showLatest) {
    // Get the list of accounts including the unified account (if it exists)
    var acctsSlice = MailAPI.viewAccounts(false);
    acctsSlice.oncomplete = function() {
      // - we have accounts, show the message view!
      if (acctsSlice.items.length) {
        // For now, just use the first one; we do attempt to put unified first
        // so this should generally do the right thing.
        // XXX: Because we don't have unified account now, we should switch to
        //       the latest account which user just added.
        var account = showLatest ? acctsSlice.items.slice(-1)[0] :
                                   acctsSlice.items[0];

        var foldersSlice = MailAPI.viewFolders('account', account);
        foldersSlice.oncomplete = function() {
          var inboxFolder = foldersSlice.getFirstFolderWithType('inbox');

          if (!inboxFolder)
            dieOnFatalError('We have an account without an inbox!',
                foldersSlice.items);


          document.getElementById('cards').innerHTML = '';

          // Clear out old cards, start fresh. This can happen for
          // an incorrect fast path guess, and likely to happen for
          // email apps that get upgraded from a version that did
          // not have the cookie fast path.
          //Cards.removeAllCards();

          // Push the message list card
          Cards.pushCard(
            'message-list', 'nonsearch', 'immediate',
            {
              folder: inboxFolder
            });

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
      } else {
        if (acctsSlice)
          acctsSlice.die();

        // - no accounts, show the setup page!
        if (!Cards.hasCard(['setup-account-info', 'default'])) {

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
          document.getElementById('cards').innerHTML = '';

          //Cards.removeAllCards();

          Cards.pushCard(
            'setup-account-info', 'default', 'immediate',
            {
              allowBack: false
            }, undefined, saveHtmlCookieCache);
        }
      }

      if (MailAPI._fake) {
        // Preload all resources after a timeout
        setTimeout(function preloadTimeout() {
          App.preloadAll();
        }, 4000);
      }
    };

    acctsSlice.oncachereset = function() {
      // Edge case cache error occurred, reset the UI.
      acctsSlice.die();
      App.showMessageViewOrSetup();
    };
  }
};

var queryURI = function _queryURI(uri) {
  function addressesToArray(addresses) {
    if (!addresses)
      return [''];
    addresses = addresses.split(';');
    var addressesArray = addresses.filter(function notEmpty(addr) {
      return addr.trim() != '';
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

function hookStartup() {
  var gotLocalized = (mozL10n.readyState === 'interactive') ||
                     (mozL10n.readyState === 'complete');

  function doInit() {
    try {
      populateTemplateNodes();
      Cards._init();
      App._init();
      App.showMessageViewOrSetup();
    }
    catch (ex) {
      console.error('Problem initializing', ex, '\n', ex.stack);
    }
  }

  if (!gotLocalized) {
    window.addEventListener('localized', function localized() {
      console.log('got localized!');
      gotLocalized = true;
      window.removeEventListener('localized', localized);
      doInit();
    });
  } else {
    doInit();
  }
}
hookStartup();

var activityCallback = null;
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
      var composer = MailAPI.beginMessageComposition(
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

    if (MailAPI && !MailAPI._fake) {
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
