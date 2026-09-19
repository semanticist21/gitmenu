# gitmenu's integrated terminal starts zsh with ZDOTDIR pointing at this directory. Each of its
# startup files runs the user's own from USER_ZDOTDIR with ZDOTDIR set to that directory, as VS
# Code's shell integration does (shellIntegration-env.zsh).
: "${USER_ZDOTDIR:=$HOME}"
if [[ -f $USER_ZDOTDIR/.zshenv ]]; then
	GITMENU_ZDOTDIR=$ZDOTDIR
	ZDOTDIR=$USER_ZDOTDIR
	# prevent recursion
	if [[ $USER_ZDOTDIR != $GITMENU_ZDOTDIR ]]; then
		. "$USER_ZDOTDIR/.zshenv"
	fi
	# ~/.zshenv may move ZDOTDIR; the other files come from there
	USER_ZDOTDIR=$ZDOTDIR
	ZDOTDIR=$GITMENU_ZDOTDIR
fi
