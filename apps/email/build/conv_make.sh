#!/bin/bash

if [ $# -eq 0 ]; then
   echo "Pass version to script"
   exit 1
fi

VER=$1

sed -i -e "s/\"certified\"/\"privileged\"/" ../manifest.webapp
rm ../manifest.webapp-e


sed -i -e "s/\"downloads\":{},//" ../manifest.webapp
rm ../manifest.webapp-e


sed -i -e "s/emailVersion = '[a-zA-Z0-9\.\-]*'/emailVersion = '${VER}-conversations'/" ../js/mail_app.js
rm ../js/mail_app.js-e

cd ../../.. && make GAIA_OPTIMIZE=1 GAIA_DEV_PIXELS_PER_PX=1.5 install-gaia APP=email

gaia-dev-zip profile/webapps/email.gaiamobile.org/application.zip email-convoy

git checkout -- apps/email/manifest.webapp
git checkout -- apps/email/js/mail_app.js
