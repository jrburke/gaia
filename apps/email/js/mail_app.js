/**
 * Application logic that isn't specific to cards, specifically entailing
 * startup and mozSetMessageHandler message listening.
 **/
'use strict';

define(function(require, exports, module) {

window.performance.mark('startMailApp');


var mozL10n = require('l10n'),
    activityComposerData = require('activity_composer_data'),
    cards = require('cards'),
    evt = require('evt'),
    model = require('model_create').defaultModel,
    HeaderCursor = require('header_cursor'),
    htmlCache = require('html_cache'),
    waitingRawActivity, activityCallback;

require('shared/js/font_size_utils');
require('metrics');
require('wake_locks');

var started = false;

var htmlCacheContents = '';

function pushStartCard(id, addedArgs) {
  var args = {
    model: model
  };

  // Mix in addedArgs to the args object that is passed to pushCard. Use a new
  // object in case addedArgs is reused again by the caller.
  if (addedArgs) {
    Object.keys(addedArgs).forEach(function(key) {
      args[key] = addedArgs[key];
    });
  }

  function finishPush() {
    if (!started) {
      var cachedNode = cards._cardsNode.children[0];

      // Add in cached node to use, if it matches the ID type.
      if (cachedNode && id === htmlCache.nodeToKey(cachedNode)) {
        // l10n may not see this as it was injected before l10n.js was loaded,
        // so let it know it needs to translate it.
        mozL10n.translateFragment(cachedNode);
        args.cachedNode = cachedNode;
      }

      //Set body class to a solid background, see bug 1077605.
  //    document.body.classList.add('content-visible');
    }

    cards.pushCard(id, 'immediate', args);

    if (!model.inited) {
      model.init();
    }

    started = true;
  }

  // if (!started) {
  //   require(['element!cards/' + id], finishPush);
  // } else {
    finishPush();
  // }
}

// Handles visibility changes: if the app becomes visible after starting up
// hidden because of a request-sync, start showing some UI.
document.addEventListener('visibilitychange', function onVisibilityChange() {
  if (!document.hidden && !started &&
      startupData && startupData.entry === 'request-sync') {
    pushStartCard('message_list');
  }
}, false);

/*
 * Determines if current card is a nonsearch message_list
 * card, which is the default kind of card.
 */
function isCurrentCardMessageList() {
  var cardType = cards.getCurrentCardType();
  return (cardType && cardType === 'message_list');
}


// The add account UI flow is requested.
evt.on('addAccount', function() {
  cards.removeAllCards();

  // Show the first setup card again.
  pushStartCard('setup_account_info', {
    allowBack: true
  });
});

function resetApp() {
  // Clear any existing local state and reset UI/model state.
  activityCallback = waitingRawActivity = undefined;
  cards.removeAllCards();

  model.init(false, function() {
    var cardId = model.hasAccount() ?
                 'message_list' : 'setup_account_info';
    pushStartCard(cardId);
  });
}

// An account was deleted. Burn it all to the ground and rise like a phoenix.
// Prefer a UI event vs. a slice listen to give flexibility about UI
// construction: an acctsSlice splice change may not warrant removing all the
// cards.
evt.on('accountDeleted', resetApp);
evt.on('resetApp', resetApp);

// Called when account creation canceled, most likely from setup_account_info.
// Need to complete the activity postError flow if an activity is waiting, then
// update the UI to the latest state.
evt.on('setupAccountCanceled', function(fromCard) {
  if (waitingRawActivity) {
    waitingRawActivity.postError('cancelled');
  }

  if (!model.foldersSlice) {
    // No account has been formally initialized, but one likely exists given
    // that this back button should only be available for cases that have
    // accounts. Likely just need the app to reset to load model.
    evt.emit('resetApp');
  } else {
    cards.removeCardAndSuccessors(fromCard, 'animate', 1);
  }
});

// A request to show the latest account in the UI. Usually triggered after an
// account has been added.
evt.on('showLatestAccount', function() {
  cards.removeAllCards();

  model.latestOnce('acctsSlice', function(acctsSlice) {
    var account = acctsSlice.items[acctsSlice.items.length - 1];

    model.changeAccount(account, function() {
      pushStartCard('message_list', {
        // If waiting to complete an activity, do so after pushing the message
        // list card.
        onPushed: function() {
          if (activityCallback) {
            var activityCb = activityCallback;
            activityCallback = null;
            activityCb();
            return true;
          }
          return false;
        }
      });
    });
  });
});

evt.on('apiBadLogin', function(account, problem, whichSide) {
  switch (problem) {
    case 'bad-user-or-pass':
      cards.pushCard('setup_fix_password', 'animate',
                { account: account,
                  whichSide: whichSide,
                  restoreCard: cards.activeCardIndex },
                'right');
      break;
    case 'imap-disabled':
    case 'pop3-disabled':
      cards.pushCard('setup_fix_gmail', 'animate',
                { account: account, restoreCard: cards.activeCardIndex },
                'right');
      break;
    case 'needs-app-pass':
      cards.pushCard('setup_fix_gmail_twofactor', 'animate',
                { account: account, restoreCard: cards.activeCardIndex },
                'right');
      break;
    case 'needs-oauth-reauth':
      cards.pushCard('setup_fix_oauth2', 'animate',
                { account: account, restoreCard: cards.activeCardIndex },
                'right');
      break;
  }
});

//------------------------------------------------------

/*jshint browser: true */
/*global performance, console, Notification */
'use strict';
var _xstart = performance.timing.fetchStart -
              performance.timing.navigationStart;
window.plog = function(msg) {
  console.log(msg + ' ' + (performance.now() - _xstart));
};

/**
 * Apparently the event catching done for the startup events from
 * performance_testing_helper record the last event received of that type as
 * the official time, instead of using the first. So unfortunately, we need a
 * global to make sure we do not emit the same events later.
 * @type {Boolean}
 */
window.startupCacheEventsSent = false;

/**
 * A function callback is registered if the model needs to be loaded before
 * final view determination can be done. This should be a rare event, but can
 * happen, see localOnModelLoaded for more details. config.js looks for this
 * callback.
 */
window.startupOnModelLoaded = null;

/**
 * Tracks if a mozSetMessageHandler has been dispatched to code. This only
 * exists to help us be efficient on closing the app in the case of notification
 * close events. If the notification system improved so that the app could tell
 * it not to notify us on close events, this could be removed. It is a global
 * so that cronsync-main can set it for request-sync operations. This file does
 * not track request-sync setMozMessageHandler messages directly, since they
 * need to acquire wake locks in the event turn the message is received. Since
 * that is a bit complicated, the back-end handles it, since it also knows more
 * about the sync details.
 */
window.appDispatchedMessage = false;


  // Holds on to the pending message type that is indicated by
  // mozHasPendingMessage. If it has a value, given by mozHasPendingMessage,
  // then startup is put on hold until it arrives. Once the mozSetMessageHandler
  // for the pending message type is received, this variable is cleared,
  // opening the way for other mozSetMessageHandler messages to be processed.
  // This is only important to track for messages that have UI impact, like
  // inserting cards. Data messages, like request-sync are fine to pass through
  // unblocked.
  var pendingUiMessageType = null;

  // There are special tasks, like DOM injection from cache, and startup of the
  // main JS scripts, that should only be done during startup, but once the app
  // has started up, then this file just handles dispatching of messages
  // received via mozSetMessageHandler.
  var startingUp = true;

  // Holds the determination of the entry point type and view that should be
  // used for startup.
  var startupData = {};

  /**
   * startupOnModelLoaded is set to this function if the
   * data_has_account localStorage value is not known. Called eventually by
   * config.js once the model module has been loaded.
   */
  function localOnModelLoaded(model, callback) {
    model.latestOnce('acctsSlice', function(acctsSlice) {
      // At this point, model will have set up 'data_has_account', so the the
      // final view can be set and the rest of the world can start turning.
      // Note that request-sync can get kicked off before this is all done,
      // since the worker will have started up and registered to get those
      // messages. It is OK though since not showing any UI. If this case is
      // triggered, it will result in a UI display in that case, but that is OK,
      // it only happens on an app update situation, from cookies to
      // localStorage or some kind of localStorage reset. So a rare event, and
      // does not cause harm, just a bit of extra work in those cases once.
      console.log('localOnModelLoaded called, hasAccount: ' +
                  localStorage.getItem('data_has_account'));

      setDefaultView();
      hydrateHtml(startupData.view);
      window.startupOnModelLoaded = null;
      callback();
    });
  }

  if (!localStorage.getItem('data_has_account')) {
    console.log('data_has_account unknown, asking for model load first');
    model.init();
    window.startupOnModelLoaded = localOnModelLoaded;
  }

  function hasAccount() {
    // var _1 = performance.now();
    var has = localStorage.getItem('data_has_account') === 'yes';
    // console.log('@@@ LOCALSTORAGE GET data_has_account: ' +
    //             (performance.now() - _1));
    return has;
  }

  function setDefaultView() {
    if (hasAccount()) {
      if (!startupData.view) {
        startupData.view = 'message_list';
      }
    } else {
      startupData.view = 'setup_account_info';
    }
  }

  // Set up the default view, but if that is not possible to know yet, since
  // the status of hasAccount is unknown, wait for the callback to set it up.
  if (!window.startupOnModelLoaded) {
    setDefaultView();
  }

  startupData.entry = 'default';

  /**
   * Makes sure the message type is wanted, given pendingUiMessageType concerns,
   * and not coming in at a fast rate due to things like double clicks. Only
   * necessary to use if the message is something that would insert cards, and
   * fast entries could mess up card state.
   */
  var lastEntryTime = 0;
  function isUiMessageTypeAllowedEntry(type) {
    // If startup is pending on a message, and this message type is not what is
    // wanted, skip it.
    if (pendingUiMessageType && pendingUiMessageType !== type) {
      console.log('Ignoring message of type: ' + type);
      return false;
    }

    var entryTime = Date.now();

    // This is the right pending startup message, so proceed without checking
    // the entryTime as it is the first one allowed through.
    if (pendingUiMessageType) {
      pendingUiMessageType = null;
    } else {
      // Check for fast incoming messages, like from activity double taps, and
      // ignore them, to avoid messing up the UI startup from double-click taps
      // of activities/notifications that would insert new cards. Only one entry
      // per second.
      if (entryTime < lastEntryTime + 1000) {
        console.log('email entry gate blocked fast repeated action: ' + type);
        return false;
      }
    }

    lastEntryTime = entryTime;
    return true;
  }

  /**
   * Gets the HTML string from cache, as well as language direction.
   * This method assumes all cookie keys that have pattern
   * /htmlc(\d+)/ are part of the object value. This method could
   * throw given vagaries of cookie cookie storage and encodings.
   * Be prepared.
   */
  function retrieve(id) {

    // var _1 = performance.now();
    var value = localStorage.getItem('html_cache_' + id) || '';
    // console.log('@@@ LOCALSTORAGE GET html_cache: ' +
    // (performance.now() - _1));

    var index, version, langDir;

    // console.log('RETRIEVED: ' + 'html_cache_' + id + ': ' + value);

    index = value.indexOf(':');

    if (index === -1) {
      value = '';
    } else {
      version = value.substring(0, index);
      value = value.substring(index + 1);

      // Version is further subdivided to include lang direction. See email's
      // l10n.js for logic to reset the dir back to the actual language choice
      // if the language direction changes between email invocations.
      var versionParts = version.split(',');
      version = versionParts[0];
      langDir = versionParts[1];
    }

    if (version !== window.HTML_CACHE_VERSION) {
      console.log('Skipping html cache for ' + id + ', out of date. Expected ' +
                  window.HTML_CACHE_VERSION + ' but found ' + version);
      value = '';
    }

    return {
      langDir: langDir,
      contents: value
    };
  }

  // Tracks the handlers that are registered via globalOnAppMessage. The
  // handlers are stored in slots that are named for the message types, like
  // 'activity', 'notification'.
  var handlers = {};

  // Holds on to messages that come in via mozSetMessageHandler until there is a
  // handler that has been registred for that message type.
  var handlerQueues = {
    notification: [],
    activity: []
  };

  /**
   * Called by app code. Only expects one listener to be registered for each
   * handler type. This function also assumes that a  `require` loader is
   * available to fetch the 'evt' module. This would not be needed if
   * evt.emit('notification') was  not triggered by the email code.
   * @param  {Object} listener Object whose keys are the handler type names and
   * values are functions that handle that type.
   */
  window.globalOnAppMessage = function(listener) {

    Object.keys(listener).forEach(function(key) {
      var fn = handlers[key] = listener[key];
      var queue = handlerQueues[key];
      if (queue.length) {
        handlerQueues[key] = [];
        queue.forEach(function(argsArray) {
          fn.apply(undefined, argsArray);
        });
      }
    });

    // Only need to do this wiring once, but globalOnAppMessage could be called
    // multiple times.
    if (!evt) {
      require(['evt'], function(ev) {
        evt = ev;
        evt.on('notification', onNotification);
      });
    }

    return startupData;
  };

  // Attach the hasAccount so that other code can use it and always get the
  // freshest cached value.
  window.globalOnAppMessage.hasAccount = hasAccount;

  function dispatch(type, args) {
    window.appDispatchedMessage = true;
    if (handlers[type]) {
      return handlers[type].apply(undefined, args);
    } else {
      handlerQueues[type].push(args);
    }

    // On the very first dispatch when app open is triggered by a dispatchable
    // event, need to finish bootup now that full startup state is known.
    finishStartup();
  }

  /**
   * Perform requested activity.
   *
   * @param {MozActivityRequestHandler} req activity invocation.
   */
  function onActivityRequest(req) {
    console.log('mozSetMessageHandler: received an activity');
    if (!isUiMessageTypeAllowedEntry('activity')) {
      return req.postError('cancelled');
    }

    // Right now all activity entry points go to compose, but may need to
    // revisited if the activity entry points change.
    if (startingUp) {
      startupData.view = 'compose';
      hydrateHtml(startupData.view);
    }

    dispatch('activity', [req]);
  }

  function onNotification(msg) {
    console.log('mozSetMessageHandler: received a notification');
    // Skip notification events that are not from a notification "click". The
    // system app will also notify this method of any close events for
    // notifications, which are not at all interesting.
    if (!msg.clicked) {
      // If a request-sync is waiting right behind this notification message,
      // that sync would will be lost when the application closes. It is an edge
      // case though, and recoverable on the next sync, where trying to be
      // accommodating to it here would add more code complexity, and it would
      // still have a failure window where the app just starts up with a
      // notification, but just after that, after startup is finished but before
      // this function is called, a sync message is queued up. Activities could
      // be dropped too in a similar situation, but we might already drop some
      // due to the fast click gate. The long term fix is to just get a
      // notification system that allows apps to tell it not to call it if just
      // closing a notification.

      // Only close if entry was a notification and no other messages, like a
      // request-sync or a UI-based message, have been dispatched.
      if (startupData.entry === 'notification' &&
          !window.appDispatchedMessage) {
        console.log('App only started for notification close, closing app.');
        window.close();
      }
      return;
    }

    // Bail early if notification is ignored. Do this before the notification
    // close() work, so that user has the opportunity to tap on the notification
    // later and still activate that notification flow.
    if (!isUiMessageTypeAllowedEntry('notification')) {
      return;
    }

    // Need to manually get all notifications and close the one that triggered
    // this event due to fallout from 890440 and 966481.
    if (typeof Notification !== 'undefined' && Notification.get) {
      Notification.get().then(function(notifications) {
        if (notifications) {
          notifications.some(function(notification) {
            // Compare tags, as the tag is based on the account ID and
            // we only have one notification per account. Plus, there
            // is no "id" field on the notification.
            if (notification.tag === msg.tag && notification.close) {
              notification.close();
              return true;
            }
          });
        }
      });
    }

    // Adjust the startupData view as desired by the notification. For upgrade
    // cases where a previous notification from an older version of email
    // used the iconUrl, this just means we will got to the message_list instead
    // of the message_reader for the single email notification case, but that is
    // OK since it is a temporary upgrade issue, and the email will still be
    // seen since it should be top of the list in the message_list.
    var view = msg.data && msg.data.type;
    if (startingUp && view) {
      startupData.view = view;
      hydrateHtml(view);
    }

    // The notification infrastructure does not automatically bring the app to
    // the foreground, so if still hidden, show it now. Ideally this would not
    // use a setTimeout, but it was getting incorrect document.hidden values on
    // startup, where just a bit later the value does seem to be set correctly.
    // The other option was to do this work inside the notification handler in
    // mail_app, but the delay is long enough waiting for that point that the
    // user might be concerned they did not correctly tap the notification.
    setTimeout(function() {
      if (document.hidden && navigator.mozApps) {
        console.log('document was hidden, showing app via mozApps.getSelf');
        navigator.mozApps.getSelf().onsuccess = function(event) {
          var app = event.target.result;
          app.launch();
        };
      }
    }, 300);

    dispatch('notification', [msg.data]);
  }


  var domInjected = false;
  function injectDom(contents) {
    domInjected = true;
    var cardsNode = document.getElementById('cards');
    cardsNode.innerHTML = contents || '';
  }

  function hydrateHtml(id) {
    var parsedResults = retrieve(id);

    if (parsedResults.langDir) {
      document.querySelector('html').setAttribute('dir', parsedResults.langDir);
    }

    htmlCacheContents = parsedResults.contents;
    window.startupCacheEventsSent = !!htmlCacheContents;

    injectDom(htmlCacheContents);
    if (window.startupCacheEventsSent) {
      window.performance.mark('navigationLoaded');
      window.performance.mark('visuallyLoaded');
    }

    if (htmlCacheContents) {
      console.log('Using HTML cache for ' + id);
    }
  }

  function finishStartup() {
    startingUp = false;
  }

  // mozHasPendingMessage seems like it can only be called once per message
  // type, so only asking once. If we have both an activity or a notification
  // coming in, the activity should win since it is part of a larger user action
  // besides just email, and expects to get some callbacks.
  if (navigator.mozHasPendingMessage) {
    if (navigator.mozHasPendingMessage('activity')) {
      pendingUiMessageType = 'activity';
    } else if (navigator.mozHasPendingMessage('notification')) {
      pendingUiMessageType = 'notification';
    }

    if (pendingUiMessageType) {
      startupData.entry = pendingUiMessageType;
    } else if (navigator.mozHasPendingMessage('request-sync')) {
      // While request-sync is not important for the pendingUiMessageType
      // gateway, it still should be indicated that the entry point was not the
      // default entry point, so that the UI is not fully started if this is a
      // background sync.
      startupData.entry = 'request-sync';
    }
  }

  if ('mozSetMessageHandler' in navigator) {
    navigator.mozSetMessageHandler('notification', onNotification);
    navigator.mozSetMessageHandler('activity', onActivityRequest);
  } else {
    console.warn('mozSetMessageHandler not available. No notifications, ' +
                 'activities or syncs.');
  }

  if (window.startupOnModelLoaded) {
    finishStartup();
  } else if (startupData.entry === 'default' ||
             startupData.entry === 'request-sync') {
    hydrateHtml(startupData.view);
    finishStartup();
  }

//------------------------------------------------------

cards.init();

/**
 * Register setMozMessageHandler listeners with the plumbing set up in
 * html_cache_restore
 */
window.globalOnAppMessage({
  activity: function(rawActivity) {
    // Remove previous cards because the card stack could get weird if inserting
    // a new card that would not normally be at that stack level. Primary
    // concern: going to settings, then trying to add a compose card at that
    // stack level. More importantly, the added card could have a "back"
    // operation that does not mean "back to previous state", but "back in
    // application flowchart". Message list is a good known jump point, so do
    // not needlessly wipe that one out if it is the current one.
    if (!isCurrentCardMessageList()) {
      cards.removeAllCards();
    }

    function activityCompose() {
      var cardArgs = {
        activity: rawActivity,
        composerData: activityComposerData(rawActivity)
      };

      pushStartCard('compose', cardArgs);
    }

    if (window.globalOnAppMessage.hasAccount()) {
      activityCompose();
    } else {
      activityCallback = activityCompose;
      waitingRawActivity = rawActivity;
      pushStartCard('setup_account_info', {
        allowBack: true,
        launchedFromActivity: true
      });
    }
  },

  notification: function(data) {
    data = data || {};
    var type = data.type || '';
    var folderType = data.folderType || 'inbox';

    model.latestOnce('foldersSlice', function latestFolderSlice() {
      function onCorrectFolder() {
        // Remove previous cards because the card stack could get weird if
        // inserting a new card that would not normally be at that stack level.
        // Primary concern: going to settings, then trying to add a reader or
        // message list card at that stack level. More importantly, the added
        // card could have a "back" operation that does not mean "back to
        // previous state", but "back in application flowchart". Message list is
        // a good known jump point, so do not needlessly wipe that one out if it
        // is the current one.
        if (!isCurrentCardMessageList()) {
          cards.removeAllCards();
        }

        if (type === 'message_list') {
          pushStartCard('message_list', {});
        } else if (type === 'message_reader') {
          var headerCursor = new HeaderCursor(model);
          headerCursor.setCurrentMessageBySuid(data.messageSuid);

          pushStartCard(type, {
              messageSuid: data.messageSuid,
              headerCursor: headerCursor
          });
        } else {
          console.error('unhandled notification type: ' + type);
        }
      }

      var acctsSlice = model.acctsSlice,
          accountId = data.accountId;

      if (model.account.id === accountId) {
        // folderType will often be 'inbox' (in the case of a new message
        // notification) or 'outbox' (in the case of a "failed send"
        // notification).
        return model.selectFirstFolderWithType(folderType, onCorrectFolder);
      } else {
        var newAccount;
        acctsSlice.items.some(function(account) {
          if (account.id === accountId) {
            newAccount = account;
            return true;
          }
        });

        if (newAccount) {
          model.changeAccount(newAccount, function() {
            model.selectFirstFolderWithType(folderType, onCorrectFolder);
          });
        }
      }
    });
  }
});

console.log('startupData: ' + JSON.stringify(startupData, null, '  '));

// If not a mozSetMessageHandler entry point, start up the UI now. Or, if
// a request-sync started the app, but the app became visible during the
// startup. In that case, make sure we show something to the user.
if (!window.startupOnModelLoaded  && (startupData.entry === 'default' ||
   (startupData.entry === 'request-sync' && !document.hidden))) {
  pushStartCard(startupData.view);
}

window.performance.mark('endMailApp');

});
