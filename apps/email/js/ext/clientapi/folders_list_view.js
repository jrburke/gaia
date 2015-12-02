define(function(require) {
'use strict';

let EntireListView = require('./entire_list_view');
let MailFolder = require('./mail_folder');

function FoldersViewSlice(api, handle) {
  EntireListView.call(this, api, MailFolder, handle);

  // enable use of latestOnce('inbox').  Note that this implementation assumes
  // the inbox is eternal.  This is generally a safe assumption, but since this
  // is a secret implementation right now, please do consider your risk profile
  // as you read this code and uncover its dark secrets.
  this.inbox = null;
  var inboxListener = function(mailFolder) {
    if (mailFolder.type === 'inbox') {
      this.inbox = mailFolder;
      this.removeListener('add', inboxListener);
    }
  }.bind(this);
}
FoldersViewSlice.prototype = Object.create(EntireListView.prototype);

/**
 * Get a folder with the given id right now, returning null if we can't find it.
 * If you expect the folder exists but you may be running in the async startup
 * path, you probably want eventuallyGetFolderById.
 */
FoldersViewSlice.prototype.getFolderById = function(id) {
  var items = this.items;
  for (var i = 0; i < items.length; i++) {
    var folder = items[i];
    if (folder.id === id) {
      return folder;
    }
  }
  return null;
};

/**
 * Promise-returning folder resolution.
 */
FoldersViewSlice.prototype.eventuallyGetFolderById = function(id) {
  return new Promise(function(resolve, reject) {
    var folder = this.getFolderById(id);
    if (folder) {
      resolve(folder);
      return;
    }
    // If already completed, immediately reject.
    if (this.complete) {
      reject('already complete');
      return;
    }

    // Otherwise we're still loading and we'll either find victory in an add or
    // inferred defeat when we get the completion notificaiton.
    var addListener = function(folder) {
      if (folder.id === id) {
        this.removeListener('add', addListener);
        resolve(folder);
      }
    }.bind(this);
    var completeListener = function() {
      this.removeListener('add', addListener);
      this.removeListener('complete', completeListener);
      reject('async complete');
    }.bind(this);
    this.on('add', addListener);
    this.on('complete', completeListener);
  }.bind(this));
};

FoldersViewSlice.prototype.getFirstFolderWithType = function(type, items) {
  // allow an explicit list of items to be provided, specifically for use in
  // onsplice handlers where the items have not yet been spliced in.
  if (!items) {
    items = this.items;
  }
  for (var i = 0; i < items.length; i++) {
    var folder = items[i];
    if (folder.type === type) {
      return folder;
    }
  }
  return null;
};

FoldersViewSlice.prototype.getFirstFolderWithName = function(name, items) {
  if (!items) {
    items = this.items;
  }
  for (var i = 0; i < items.length; i++) {
    var folder = items[i];
    if (folder.name === name) {
      return folder;
    }
  }
  return null;
};

FoldersViewSlice.prototype.getFirstFolderWithPath = function(path, items) {
  if (!items) {
    items = this.items;
  }
  for (var i = 0; i < items.length; i++) {
    var folder = items[i];
    if (folder.path === path) {
      return folder;
    }
  }
  return null;
};

return FoldersViewSlice;
});
