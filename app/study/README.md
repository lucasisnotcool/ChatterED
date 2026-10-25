# app/study

The study build's sealed key bundle goes here as `keys.json`, but only while
`tools/release.sh --study <bundle>` is building. The script copies the bundle in and removes it
when the build finishes. `keys.json` is gitignored, and an ordinary build refuses to start while
one is present. The same holds for `preload.txt`, one participant's code, which
`release.sh --preload <slot>` puts here for a copy that needs no typing.

The bundle and the participant codes are made by `npm run study:keys`, outside the repo. See
`app/docs/STUDY-RELEASE.md`.
