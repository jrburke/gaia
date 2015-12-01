define(function (require) {
  'use strict';

  const logic = require('logic');
  const co = require('co');
  const TaskDefiner = require('../task_infra/task_definer');

  /**
   * Manipulate identity settings.  Right now we only support one identity per
   * account and we hard-code the path, though it wouldn't take much to
   */
  return TaskDefiner.defineSimpleTask([{
    name: 'identity_modify',

    plan: co.wrap(function* (ctx, rawTask) {
      // Access the account for read-only consultation.  Because we don't need
      // to wait on any network access and because of how things actually work,
      // we could absolutely acquire this for write mutation and do an explicit
      // write.  However, by using the clobber mechanism we are able to have
      // prettier/more explicit logging and also have unit tests that more
      // directly ensure what we're doing in here is correct as it relates to
      // to our conditionalized username/password logic.
      const accountClobbers = new Map();

      // for now there's still only one identity.
      const identIndex = 0;
      const identPath = ['identities', identIndex];

      for (var key in rawTask.mods) {
        const val = rawTask.mods[key];

        switch (key) {
          case 'name':
            accountClobbers.set(identPath.concat('name'), val);
            break;

          case 'address':
            accountClobbers.set(identPath.concat('address'), val);
            break;

          case 'replyTo':
            accountClobbers.set(identPath.concat('replyTo'), val);
            break;

          case 'signature':
            accountClobbers.set(identPath.concat('signature'), val);
            break;

          case 'signatureEnabled':
            accountClobbers.set(identPath.concat('signatureEnabled'), val);
            break;

          default:
            logic(ctx, 'badModifyIdentityKey', { key });
            break;
        }
      }

      yield ctx.finishTask({
        atomicClobbers: {
          accounts: new Map([[rawTask.accountId, accountClobbers]])
        }
      });
    })
  }]);
});
