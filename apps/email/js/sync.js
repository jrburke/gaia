/*jshint browser: true */
/*global define, console */
'use strict';
define(function(require) {

  var cronSyncStartTime,
      appSelf = require('app_self'),
      evt = require('evt'),
      mozL10n = require('l10n!'),
      notificationHelper = require('shared/js/notification_helper');

  // Version marker for the notification data format. It is a string because
  // query_string only deals in strings. If the format of the notification data
  // changes, then this version needs to be changed.
  var notificationDataVersion = '1';

  // The expectation is that this module is called as part of model's
  // init process that calls the "model_init" module to finish its construction.
  return function syncInit(model, api) {
    var hasBeenVisible = !document.hidden,
        waitingOnCron = {};

    // Let the back end know the app is interactive, not just
    // a quick sync and shutdown case, so that it knows it can
    // do extra work.
    if (hasBeenVisible) {
      api.setInteractive();
    }

    // If the page is ever not hidden, then do not close it later.
    document.addEventListener('visibilitychange',
      function onVisibilityChange() {
        if (!document.hidden) {
          hasBeenVisible = true;
          api.setInteractive();
        }
    }, false);

    // Creates a string key from an array of string IDs. Uses a space
    // separator since that cannot show up in an ID.
    function makeAccountKey(accountIds) {
      return 'id' + accountIds.join(' ');
    }

    var sendNotification;
    if (typeof Notification !== 'function') {
      console.log('email: notifications not available');
      sendNotification = function() {};
    } else {
      sendNotification = function(notificationId, titleL10n, bodyL10n,
                                  iconUrl, data, behavior) {
        console.log('Notification sent for ' + notificationId);

        if (Notification.permission !== 'granted') {
          console.log('email: notification skipped, permission: ' +
                      Notification.permission);
          return;
        }

        data = data || {};

        // TODO: consider setting dir and lang?
        //https://developer.mozilla.org/en-US/docs/Web/API/notification
        var notificationOptions = {
          bodyL10n: bodyL10n,
          icon: iconUrl,
          tag: notificationId,
          data: data,
          mozbehavior: {
            noscreen: true
          },
          closeOnClick: false
        };

        if (behavior) {
          Object.keys(behavior).forEach(function(key) {
            notificationOptions.mozbehavior[key] = behavior[key];
          });
        }

        notificationHelper.send(titleL10n, notificationOptions)
          .then(function(notification){
            // If the app is open, but in the background, when the notification
            // comes in, then we do not get notifived via our
            // mozSetMessageHandler that is set elsewhere. Instead need to
            // listen to click event and synthesize an "event" ourselves.
            notification.onclick = function() {
              evt.emit('notification', {
                clicked: true,
                imageURL: iconUrl,
                tag: notificationId,
                data: data
              });
            };
          });
      };
    }

    api.oncronsyncstart = function(accountIds) {
      console.log('email oncronsyncstart: ' + accountIds);
      cronSyncStartTime = Date.now();
      var accountKey = makeAccountKey(accountIds);
      waitingOnCron[accountKey] = true;
    };

    /**
     * Fetches notification data for the notification type, ntype. This method
     * assumes there is only one ntype of notification per account.
     * @param  {String} ntype The notification type, like 'sync'.
     * @return {Promise}      Promise that resolves to a an object whose keys
     * are account IDs and values are notification data.
     */
    function fetchNotificationsData(ntype) {
      if (typeof Notification !== 'function' || !Notification.get) {
        return Promise.resolve({});
      }

      return Notification.get().then(function(notifications) {
        var result = {};
        notifications.forEach(function(notification) {
          var data = notification.data;

          // Want to avoid unexpected data formats. So if not a version match
          // then just close it since it cannot be processed as expected. This
          // means that notifications not generated by this module may be
          // closed. However, ideally only this module generates notifications,
          // for localization of concerns.
          if (!data.v || data.v !== notificationDataVersion) {
            notification.close();
          } else if (data.ntype === ntype) {
            data.notification = notification;
            result[data.accountId] = data;
          }
        });
        return result;
      }, function(err) {
        // Do not care about errors, just log and keep going.
        console.error('email notification.get call failed: ' + err);
        return {};
      });
    }

    /**
     * Helper to just get some environment data for dealing with sync-based
     * notfication data. Exists to reduce the curly brace pyramid of doom and
     * to normalize existing sync notification info.
     * @param {Function} fn function to call once env info is fetched.
     */
    function getSyncEnv(fn) {
      appSelf.latest('self', function(app) {
        model.latestOnce('account', function(currentAccount) {
          fetchNotificationsData('sync').then(
            function(existingNotificationsData) {
              mozL10n.formatValue('senders-separation-sign')
              .then(function(separator) {
                var localized = {
                  separator
                };
                mozL10n.formatValue('notification-no-subject')
                .then(function(noSubject) {
                  localized.noSubject = noSubject;
                  fn(app, currentAccount, existingNotificationsData, localized);
                });
            });
          });
        });
      });
    }

    /**
     * Generates a list of unique top names sorted by most recent sender first,
     * and limited to a max number. The max number is just to limit amount of
     * work and likely display limits.
     * @param  {Array} latestInfos  array of result.latestMessageInfos. Modifies
     * result.latestMessageInfos via a sort.
     * @param  {Array} oldFromNames old from names from a previous notification.
     * @return {Array} a maxFromList array of most recent senders.
     */
    function topUniqueFromNames(latestInfos, oldFromNames) {
      var names = [],
          maxCount = 3;

      // Get the new from senders from the result. First,
      // need to sort by most recent.
      // Note that sort modifies result.latestMessageInfos
      latestInfos.sort(function(a, b) {
       return b.date - a.date;
      });

      // Only need three unique names, and just the name, not
      // the full info object.
      latestInfos.some(function(info) {
        if (names.length > maxCount) {
          return true;
        }

        if (names.indexOf(info.from) === -1) {
          names.push(info.from);
        }
      });

      // Now add in old names to fill out a list of
      // max names.
      oldFromNames.some(function(name) {
        if (names.length > maxCount) {
          return true;
        }
        if (names.indexOf(name) === -1) {
          names.push(name);
        }
      });

      return names;
    }

    /*
    accountsResults is an object with the following structure:
      accountIds: array of string account IDs.
      updates: array of objects includes properties:
        id: accountId,
        name: account name,
        count: number of new messages total
        latestMessageInfos: array of latest message info objects,
        with properties:
          - from
          - subject
          - accountId
          - messageSuid
     */
    api.oncronsyncstop = function(accountsResults) {
      console.log('email oncronsyncstop: ' + accountsResults.accountIds);

      function finishSync() {
        evt.emit('cronSyncStop', accountsResults.accountIds);

        // Mark this accountId set as no longer waiting.
        var accountKey = makeAccountKey(accountsResults.accountIds);
        waitingOnCron[accountKey] = false;
        var stillWaiting = Object.keys(waitingOnCron).some(function(key) {
          return !!waitingOnCron[key];
        });

        if (!hasBeenVisible && !stillWaiting) {
          console.log('sync completed in ' +
                     ((Date.now() - cronSyncStartTime) / 1000) +
                     ' seconds, closing mail app');
          window.close();
        }
      }

      // If no sync updates, wrap it up.
      if (!accountsResults.updates) {
        finishSync();
        return;
      }

      // There are sync updates, get environment and figure out how to notify
      // the user of the updates.
      getSyncEnv(function(
                 app, currentAccount, existingNotificationsData, localized) {
        var iconUrl = notificationHelper.getIconURI(app);

        accountsResults.updates.forEach(function(result) {
          // If the current account is being shown, then just send an update
          // to the model to indicate new messages, as the notification will
          // happen within the app for that case. The 'inboxShown' pathway
          // will be sure to close any existing notification for the current
          // account.
          if (currentAccount.id === result.id && !document.hidden) {
            model.notifyInboxMessages(result);
            return;
          }

          // If this account does not want notifications of new messages
          // or if no Notification object, stop doing work.
          if (!model.getAccount(result.id).notifyOnNew ||
              typeof Notification !== 'function') {
            return;
          }

          var dataObject, subjectL10n, bodyL10n, behavior,
              count = result.count,
              oldFromNames = [];

          // Adjust counts/fromNames based on previous notification.
          var existingData = existingNotificationsData[result.id];
          if (existingData) {
            if (existingData.count) {
              count += parseInt(existingData.count, 10);
            }
            if (existingData.fromNames) {
              oldFromNames = existingData.fromNames;
            }
          }

          if (count > 1) {
            // Multiple messages were synced.
            // topUniqueFromNames modifies result.latestMessageInfos
            var newFromNames = topUniqueFromNames(result.latestMessageInfos,
                                                  oldFromNames);
            dataObject = {
              v: notificationDataVersion,
              ntype: 'sync',
              type: 'message_list',
              accountId: result.id,
              count: count,
              fromNames: newFromNames
            };

            // If already have a notification, then do not bother with sound or
            // vibration for this update. Longer term, the notification standard
            // will have a "silent" option, but using a non-existent URL as
            // suggested in bug 1042361 in the meantime.
            if (existingData && existingData.count) {
              behavior = {
                soundFile: 'does-not-exist-to-simulate-silent',
                // Cannot use 0 since system/js/notifications.js explicitly
                // ignores [0] values. [1] is good enough for this purpose.
                vibrationPattern: [1]
              };
            }

            if (model.getAccountCount() === 1) {
              subjectL10n = {
                id: 'new-emails-notify-one-account',
                args: { n: count }
              };
            } else {
              subjectL10n = {
                id: 'new-emails-notify-multiple-accounts',
                args: {
                  n: count,
                  accountName: result.address
                }
              };
            }

            bodyL10n = { raw: newFromNames.join(localized.separator) };

          } else {
            // Only one message to notify about.
            var info = result.latestMessageInfos[0];
            dataObject = {
              v: notificationDataVersion,
              ntype: 'sync',
              type: 'message_reader',
              accountId: info.accountId,
              messageSuid: info.messageSuid,
              count: 1,
              fromNames: [info.from]
            };

            var rawSubject = info.subject || localized.noSubject;

            if (model.getAccountCount() === 1) {
              subjectL10n = { raw: rawSubject };
              bodyL10n = { raw: info.from };
            } else {
              subjectL10n = {
                id: 'new-emails-notify-multiple-accounts',
                args: {
                  n: count,
                  accountName: result.address
                }
              };
              bodyL10n = {
                id: 'new-emails-notify-multiple-accounts-body',
                args: {
                  from: info.from,
                  subject: rawSubject
                }
              };
            }
          }

          sendNotification(
            result.id,
            subjectL10n,
            bodyL10n,
            iconUrl,
            dataObject,
            behavior
          );
        });

        finishSync();
      });
    };

    // Background Send Notifications

    var BACKGROUND_SEND_NOTIFICATION_ID = 'backgroundSendFailed';
    var sentAudio = null; // Lazy-loaded when first needed

    /**
     * The API passes through background send notifications with the
     * following data (see the "sendOutboxMessages" job and/or
     * `GELAM/js/jobs/outbox.js`):
     *
     * @param {int} accountId
     * @param {string} suid
     *   SUID of the message
     * @param {string} state
     *   'pending', 'syncing', 'success', or 'error'
     * @param {string} err
     *   (if applicable, otherwise null)
     * @param {array} badAddresses
     *   (if applicable)
     * @param {int} sendFailures
     *   Count of the number of times the message failed to send.
     * @param {Boolean} emitNotifications
     *   True if this message is being sent as a direct result of
     *   the user sending a message from the compose window. False
     *   otherwise, as in when the user "refreshes" the outbox.
     * @param {Boolean} willSendMore
     *   True if we will send a subsequent message from the outbox
     *   immediately after sending this message.
     *
     * Additionally, this function appends the following to that
     * structured data:
     *
     * @param {string} localizedDescription Notification text.
     *
     * If the application is in the foreground, we notify the user on
     * both success and failure. If the application is in the
     * background, we only post a system notifiaction on failure.
     */
    api.onbackgroundsendstatus = function(data) {
      console.log('outbox: Message', data.suid, 'status =', JSON.stringify({
        state: data.state,
        err: data.err,
        sendFailures: data.sendFailures,
        emitNotifications: data.emitNotifications
      }));

      // Grab an appropriate localized string here. This description
      // may be displayed in a number of different places, so it's
      // cleaner to do the localization here.

      var descId;
      switch (data.state) {
      case 'pending': descId = 'background-send-pending'; break;
      case 'sending': descId = 'background-send-sending'; break;
      case 'success': descId = 'background-send-success'; break;
      case 'error':
        if ((data.badAddresses && data.badAddresses.length) ||
            data.err === 'bad-recipient') {
          descId = 'background-send-error-recipients';
        } else {
          descId = 'background-send-error';
        }
        break;
      case 'syncDone':
        // We will not display any notification for a 'syncDone'
        // message, except to stop refresh icons from spinning. No
        // need to attempt to populate a description.
        break;
      default:
        console.error('No state description for background send state "' +
                      data.state + '"');
        return;
      }

      // If the message sent successfuly, and we're sending this as a
      // side-effect of the user hitting "send" on the compose screen,
      // (i.e. emitNotifications is true), we may need to play a sound.
      if (data.state === 'success') {
        // Grab an up-to-date reading of the "play sound on send"
        // preference to decide if we're going to play a sound or not.
        model.latestOnce('acctsSlice', () => {
          var account = model.getAccount(data.accountId);
          if (!account) {
            console.error('Invalid account ID', data.accountId,
                          'for a background send notification.');
            return;
          }

          // If email is in the background, we should still be able to
          // play audio due to having the 'audio-channel-notification'
          // permission (unless higher priority audio is playing).

          // TODO: As of June 2014, this behavior is still in limbo;
          // see the following links for relevant discussion. We may
          // need to follow up to ensure we get the behavior we want
          // (which is to play a sound when possible, even if we're in
          // the background).
          //   Thread on dev-gaia: http://goo.gl/l6REZy
          //   AUDIO_COMPETING bugs: https://bugzil.la/911238
          if (account.playSoundOnSend) {
            if (!sentAudio) {
              sentAudio = new Audio('/sounds/firefox_sent.opus');
              sentAudio.mozAudioChannelType = 'notification';
            }
            sentAudio.play();
          }
        });
      }

      // If we are in the foreground, notify through the model, which
      // will display an in-app toast notification when appropriate.
      if (!document.hidden) {
        mozL10n.formatValue(descId).then(function(localizedDescription) {
          data.localizedDescription = localizedDescription;
          model.notifyBackgroundSendStatus(data);
        });
      }
      // Otherwise, notify with a system notification in the case of
      // an error. By design, we don't use system-level notifications
      // to notify the user on success, lest they get inundated with
      // notifications.
      else if (data.state === 'error' && data.emitNotifications) {
        appSelf.latest('self', function(app) {
          var iconUrl = notificationHelper.getIconURI(app);
          var dataObject = {
            v: notificationDataVersion,
            ntype: 'outbox',
            type: 'message_reader',
            folderType: 'outbox',
            accountId: data.accountId,
            messageSuid: data.suid
          };

          sendNotification(
            BACKGROUND_SEND_NOTIFICATION_ID,
            'background-send-error-title',
            descId,
            iconUrl,
            dataObject
          );
        });
      }
    };

    // When inbox is viewed, be sure to clear out any possible notification
    // for that account.
    evt.on('inboxShown', function(accountId) {
      fetchNotificationsData('sync').then(function(notificationsData) {
        if (notificationsData.hasOwnProperty(accountId)) {
          notificationsData[accountId].notification.close();
        }
      });
    });
  };
});
