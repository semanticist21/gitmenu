# The user's .zprofile (see .zshenv here)
if [[ $options[norcs] = off && -o login && -f $USER_ZDOTDIR/.zprofile ]]; then
	GITMENU_ZDOTDIR=$ZDOTDIR
	ZDOTDIR=$USER_ZDOTDIR
	. "$USER_ZDOTDIR/.zprofile"
	ZDOTDIR=$GITMENU_ZDOTDIR
fi
