var Email = require('./email');
var assert = require('assert');
var serverHelper = require('./lib/server_helper');

marionette('receive a email via SMTP', function() {
  var app,
      notificationContainer,
      client = marionette.client({
        settings: {
          // disable keyboard ftu because it blocks our display
          'keyboard.ftu.enabled': false
        }
      }),
      server1 = serverHelper.use({
                  credentials: {
                    username: 'testy1',
                    password: 'testy1'
                  }
                }, this);
      server2 = serverHelper.use({
                  credentials: {
                    username: 'testy2',
                    password: 'testy2'
                  }
                }, this);

  function sendEmail(server) {
    var email = server.imap.username + '@' + server.imap.hostname;
    app.tapCompose();
    app.typeTo(email);
    app.typeSubject('test email');
    app.typeBody('I still have a dream.');
    app.tapSend();
  }

  setup(function() {
    notificationContainer =
      client.findElement('#desktop-notifications-container');
    app = new Email(client);

    client.contentScript.inject(__dirname +
      '/lib/mocks/mock_navigator_moz_set_message_handler.js');
    app.launch();

    // setup two email accounts
    app.manualSetupImapEmail(server1);
    app.tapFolderListButton();
    app.tapSettingsButton();
    app.tapAddAccountButton();
    app.manualSetupImapEmail(server2);
    // write a email to testy1@localhost
    sendEmail(server1);
  });

  test('should have a notification in the different account', function() {
    // trigger sync in Email App
    client.executeScript(function() {
      var interval = 1000;
      var date = new Date(Date.now() + interval).getTime();
      var alarm = {
        data: {
          type: 'sync',
          accountIds: ['0', '1'],
          interval: interval,
          timestamp: date
        }
      };
      return window.wrappedJSObject.fireMessageHandler(alarm);
    });
    // wait for the sync process to complete
    client.helper.wait(2000);

    notificationContainer.findElement('div', function(error, element) {
      if (error) {
        assert.ok(false);
      } else {
        assert.ok(true);
      }
    });
  });

  test('should NOT have a notification in the same account', function() {
    app.tapFolderListButton();
    app.tapAccountListButton();
    // switch to the testy1 account
    app.switchAccount(1);
    // hide the folder list page
    app.tapFolderListButton();
    app.tapRefreshButton();

    notificationContainer.findElement('div', function(error, element) {
      if (error) {
        assert.ok(true);
      } else if (element) {
        assert.ok(false);
      }
    });
  });
});
