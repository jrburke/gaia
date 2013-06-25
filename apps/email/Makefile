SYS=$(shell uname -s)

ifeq ($(SYS),Darwin)
XULRUNNERSDK=../../xulrunner-sdk/bin/XUL.framework/Versions/Current/run-mozilla.sh
XPCSHELLSDK=../../xulrunner-sdk/bin/XUL.framework/Versions/Current/xpcshell
else ifeq ($(findstring MINGW32,$(SYS)), MINGW32)
# For windows we only have one binary
XULRUNNERSDK=
XPCSHELLSDK=../../xulrunner-sdk/bin/xpcshell
else
# Otherwise, assume linux
XULRUNNERSDK=../../xulrunner-sdk/bin/run-mozilla.sh
XPCSHELLSDK=../../xulrunner-sdk/bin/xpcshell
endif

concatenated_scripts:
	rm -rf ./shared
	cp -r ../../shared ./shared
	$(XULRUNNERSDK) $(XPCSHELLSDK) ../../build/r.js -o build/email.build.json logLevel=3
	$(XULRUNNERSDK) $(XPCSHELLSDK) ../../build/r.js -o cssIn=style/mail.css out=style/mail_built.css logLevel=3
