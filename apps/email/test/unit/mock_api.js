/*jshint browser: true */
/*global define */
'use strict';

define(function() {
  var evt = require('evt');
  var api;

  api = {
    setInteractive: function() {},
    useLocalizedStrings: function() {},

    viewAccounts: function() {
      var account = {
        id: 'fake_account',
        name: 'fake account'
      };

      var accounts = evt.mix({
        items: [
          account
        ],
        defaultAccount: account,
        release: function() {}
      });

      setTimeout(function() {
        accounts.emit('complete');
      });

      return accounts;
    },

    viewFolderMessages: function() {
      var list = {
        items: [],
        release: function() {}
      };

      return list;
    },

    viewFolders: function(mode, argument) {
      var inboxFolder = evt.mix({
          id: 'fake_inbox',
          type: 'inbox',
          name: 'inbox'
        });

      var folders = {
        items: [
          inboxFolder
        ],

        getFirstFolderWithType: function(type) {
          if (type !== 'inbox') {
            throw new Error('Only type of inbox supported in mock_api');
          }

          return inboxFolder;
        },

        release: function() {}
      };

      setTimeout(function() {
        folders.emit('complete', folders);
      });

      return folders;
    }
  };

  return api;
});
