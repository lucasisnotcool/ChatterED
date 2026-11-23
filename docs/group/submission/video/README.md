# How the demo video was made

`ChatterED-demo.mp4` (6 min 52 s, silent) is one continuous take of the grading copy, from first
launch to a revealed answer. It was filmed on 23 Nov 2026 on the build made from app commit
`c0e42a9`, with a fresh profile and the live model. It is the third filming of that day: the
second came after the sample gained its lecture slides (the first video showed the sheet on its
own), and this one after the sample began to ship already read, so the video no longer shows a
minute's wait that the submitted copy does not have. The sample opens within a second of the
button; every reply after that is the live model.

- `take.mjs` is the script of the walk-through: what is pressed and typed, in order.
- `film.mjs` drives the app's real interface through the DevTools protocol and records the app's
  own window: a capture about six times a second (`Page.captureScreenshot`), each saved with its
  real timestamp. ffmpeg joins the frames at their real durations. Nothing is cut, sped up or
  reordered.

A first take used a recorder that saves a frame only when the page reports a change
(`Page.startScreencast`). It missed the frame in which the first tour card appears, so that take
showed a blank "Opening…" screen for ten seconds and never showed the card. The app itself was
fine: the card is on screen 0.1 s after Continue is pressed. That take was thrown away, and the
video was filmed again at a fixed rate and checked at one frame every eight seconds.

Because the recording is of the window's contents, it shows no mouse pointer, no title bar and no
menus. Each button press appears as a line in the part's thread ("Hint, please: Q1 (a)").

To film again: copy the built `ChatterED.app` into any folder named `Applications` (outside one,
the app first offers to install itself), then

```sh
env -u ELECTRON_RUN_AS_NODE open -n <Applications>/ChatterED.app --args \
    --remote-debugging-port=9351 --user-data-dir=<a new empty folder>
node take.mjs 9351 <that folder> <output folder>
cd <output folder> && ffmpeg -f concat -safe 0 -i frames.ffconcat -vf "fps=15,scale=1920:-2" \
    -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -movflags +faststart ChatterED-demo.mp4
```

Delete the profile folder afterwards: it holds the copy's API key in a plain file.
