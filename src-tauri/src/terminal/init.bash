# gitmenu's integrated terminal runs `bash --init-file <this> -i`. --init-file can't be combined
# with a login shell, so this runs the login startup files the way `bash -l` would, as VS Code's
# shell integration does (shellIntegration-bash.sh), then git's completion if the user's config
# didn't load it.
if [ -r /etc/profile ]; then
	. /etc/profile
fi
if [ -r ~/.bash_profile ]; then
	. ~/.bash_profile
elif [ -r ~/.bash_login ]; then
	. ~/.bash_login
elif [ -r ~/.profile ]; then
	. ~/.profile
fi

if ! declare -F __git_complete >/dev/null; then
	for __gitmenu_completion in \
		/Library/Developer/CommandLineTools/usr/share/git-core/git-completion.bash \
		/Applications/Xcode.app/Contents/Developer/usr/share/git-core/git-completion.bash \
		/opt/homebrew/etc/bash_completion.d/git-completion.bash \
		/usr/local/etc/bash_completion.d/git-completion.bash; do
		if [ -r "$__gitmenu_completion" ]; then
			. "$__gitmenu_completion"
			break
		fi
	done
	unset __gitmenu_completion
fi
