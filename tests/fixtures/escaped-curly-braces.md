Consider a normal window with an HD video player and associated controls.
Perhaps there are 15 pixels of controls on the left edge, 25 pixels of controls
on the right edge and 50 pixels of controls below the player. In order to
maintain a 16:9 aspect ratio (standard aspect ratio for HD @1920x1080) within
the player itself we would call this function with arguments of 16/9 and
\{ width: 40, height: 50 \}. The second argument doesn't care where the extra width and height
are within the content view--only that they exist. Sum any extra width and
height areas you have within the overall content view.
