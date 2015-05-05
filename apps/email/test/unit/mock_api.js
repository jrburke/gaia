/*jshint browser: true */
/*global define */
'use strict';

define(function() {
  var api;

  api = {
    setInteractive: function() {},
    useLocalizedStrings: function() {},

    viewAccounts: function() {
      var account = {
        id: 'fake_account',
        name: 'fake account'
      };

      var acctsSlice = {
        items: [
          account
        ],
        defaultAccount: account,
        release: function() {}
      };

      setTimeout(function() {
        if (!acctsSlice.oncomplete) {
          return;
        }

        acctsSlice.oncomplete();
      });

      return acctsSlice;
    },

    viewFolderMessages: function() {
      var list = {
        items: [],
        release: function() {}
      };

      return list;
    },

    viewFolders: function(mode, argument) {
      var inboxFolder = {
          id: 'fake_inbox',
          type: 'inbox',
          name: 'inbox'
        };

      var foldersList = {
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
        if (!foldersList.oncomplete) {
          return;
        }

        foldersList.oncomplete();
      });

      return foldersList;
    }
  };

  return api;
});
