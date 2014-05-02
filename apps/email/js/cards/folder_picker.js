/*global define */
'use strict';
define(function(require) {

var fldFolderItemNode = require('tmpl!./fld/folder_item.html'),
    FOLDER_DEPTH_CLASSES = require('folder_depth_classes'),
    cards = require('cards'),
    date = require('date'),
    model = require('model'),
    mozL10n = require('l10n!');

require('css!style/folder_cards');

return [
  require('./base')(require('template!./folder_picker.html')),
  {
    createdCallback: function() {
      this.bindContainerHandler(this.foldersContainer, 'click',
                       this.onClickFolder.bind(this));

      this.updateAccount = this.updateAccount.bind(this);
      model.latest('account', this.updateAccount);
    },

    nextCards: ['settings_main', 'account_picker'],

    onShowSettings: function() {
      cards.pushCard(
        'settings_main', 'animate', {}, 'left');
    },

    /**
     * Clicking a different account changes the list of folders displayed.  We
     * then trigger a select of the inbox for that account because otherwise
     * things get permutationally complex.
     */
    updateAccount: function(account) {
      var oldAccount = this.curAccount;

      this.mostRecentSyncTimestamp = 0;

      if (oldAccount !== account) {
        this.foldersContainer.innerHTML = '';
        date.setPrettyNodeDate(this.lastSyncedAtNode);

        model.latestOnce('folder', function(folder) {
          this.curAccount = account;

          // - DOM!
          this.updateSelfDom();

          // update header
          this.headerAccountLabel.textContent = account.name;

          // If no current folder, means this is the first startup, do some
          // work to populate the
          if (!this.curFolder) {
            this.curFolder = folder;
          }

          // Clean up any old bindings.
          if (this.foldersSlice) {
            this.foldersSlice.onsplice = null;
            this.foldersSlice.onchange = null;
          }

          this.foldersSlice = model.foldersSlice;

          // since the slice is already populated, generate a fake
          // notification
          this.onFoldersSplice(0, 0, this.foldersSlice.items, true, false);

          // Listen for changes in the foldersSlice.
          // TODO: perhaps slices should implement an event listener
          // interface vs. only allowing one handler. This is slightly
          // dangerous in that other cards may access model.foldersSlice
          // and could decide to set these handlers, wiping these ones
          // out. However, so far folder_picker is the only one that cares
          // about these dynamic updates.
          this.foldersSlice.onsplice = this.onFoldersSplice.bind(this);
          this.foldersSlice.onchange = this.onFoldersChange.bind(this);
        }.bind(this));
      }
    },
    onShowAccounts: function() {
      if (!this.curAccount) {
        return;
      }

      // Add account picker before this folder list.
      cards.pushCard(
        'account_picker', 'animate',
        {
          curAccountId: this.curAccount.id
        },
        // Place to left of message list
        'left');
    },

    onFoldersSplice: function(index, howMany, addedItems,
                               requested, moreExpected) {
      var foldersContainer = this.foldersContainer;

      var folder;
      if (howMany) {
        for (var i = index + howMany - 1; i >= index; i--) {
          folder = this.foldersSlice.items[i];
          foldersContainer.removeChild(folder.element);
        }
      }

      var dirtySyncTime = false;
      var insertBuddy = (index >= foldersContainer.childElementCount) ?
                          null : foldersContainer.children[index],
          self = this;
      addedItems.forEach(function(folder) {
        var folderNode = folder.element = fldFolderItemNode.cloneNode(true);
        folderNode.folder = folder;
        self.updateFolderDom(folder, true);
        foldersContainer.insertBefore(folderNode, insertBuddy);

        if (self.mostRecentSyncTimestamp < folder.lastSyncedAt) {
          self.mostRecentSyncTimestamp = folder.lastSyncedAt;
          dirtySyncTime = true;
        }
      });
      if (dirtySyncTime) {
        this.updateLastSyncedUI();
      }
    },

    onFoldersChange: function(folder) {
      if (this.mostRecentSyncTimestamp < folder.lastSyncedAt) {
        this.mostRecentSyncTimestamp = folder.lastSyncedAt;
        this.updateLastSyncedUI();
      }
    },

    updateLastSyncedUI: function() {
      if (this.mostRecentSyncTimestamp) {
        date.setPrettyNodeDate(this.lastSyncedAtNode,
                               this.mostRecentSyncTimestamp);
      } else {
        this.lastSyncedAtNode.textContent =
                                          mozL10n.get('account-never-synced');
      }
    },

    updateSelfDom: function(isAccount) {
      var str = isAccount ? mozL10n.get('settings-account-section') :
        this.curAccount.name;
      this.headerAccountLabel.textContent = str;

      // Update account problem status
      if (this.curAccount.problems.length) {
        this.toolbarAccountProblemNode.classList.remove('collapsed');
      } else {
        this.toolbarAccountProblemNode.classList.add('collapsed');
      }
    },

    updateFolderDom: function(folder, firstTime) {
      var folderNode = folder.element;

      if (firstTime) {
        if (!folder.selectable) {
          folderNode.classList.add('fld-folder-unselectable');
        }
        var depthIdx = Math.min(FOLDER_DEPTH_CLASSES.length - 1,
                                folder.depth);
        folderNode.classList.add(FOLDER_DEPTH_CLASSES[depthIdx]);

        folderNode.getElementsByClassName('fld-folder-name')[0]
          .textContent = folder.name;
        folderNode.dataset.type = folder.type;
      }

      if (folder === this.curFolder) {
        folderNode.classList.add('fld-folder-selected');
      } else {
        folderNode.classList.remove('fld-folder-selected');
      }

      // XXX do the unread count stuff once we have that info
    },

    onClickFolder: function(folderNode, event) {
      var folder = folderNode.folder;
      if (!folder.selectable) {
        return;
      }

      var oldFolder = this.curFolder;
      this.curFolder = folder;
      this.updateFolderDom(oldFolder);
      this.updateFolderDom(folder);

      this._showFolder(folder);
      cards.moveToCard('message_list');
    },

    /**
     * Tell the message-list to show this folder; exists for single code path.
     */
    _showFolder: function(folder) {
      model.changeFolder(folder);
    },

    /**
     * Our card is going away; perform all cleanup except destroying our DOM.
     * This will enable the UI to animate away from our card without weird
     * graphical glitches.
     */
    die: function() {
      model.removeListener('account', this.updateAccount);
    }
  }
];

});
