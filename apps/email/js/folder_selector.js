'use strict';
define(function(require) {
  var mozL10n = require('l10n!');

  // Filter is an optional paramater. It is a function that returns
  // true if the folder passed to it should be included in the selector
  return function folderSelector(model, callback, filter) {
    var self = this;

    require(['value_selector'], function(ValueSelector) {
      // XXX: Unified folders will require us to make sure we get the folder
      //      list for the account the message originates from.
      if (!self.folderPrompt) {
        var selectorTitle = mozL10n.get('messages-folder-select');
        self.folderPrompt = new ValueSelector(selectorTitle);
      }

      model.account.folders.latestOnce('account', function(account) {
        var folders = account.folders.items;
        folders.forEach(function(folder) {
          var isMatch = !filter || filter(folder);
          if (folder.neededForHierarchy || isMatch) {
            self.folderPrompt.addToList(folder.name, folder.depth,
              isMatch,
              function(folder) {
                return function() {
                  self.folderPrompt.hide();
                  callback(folder);
                };
              }(folder));
          }
        });
        self.folderPrompt.show();
      });
    });
  };
});
