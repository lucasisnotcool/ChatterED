/*
 * chattered-swap A B: exchange two directory entries atomically (renamex_np RENAME_SWAP, APFS).
 *
 * The update helper (src/main/update/plan.ts, SWAP_SCRIPT) swaps the staged bundle with the
 * installed one in one step, so there is never a moment with no ChatterED.app, even if the
 * helper is killed at logout. Built by scripts/build-swap.mjs, shipped in Contents/Resources.
 *
 * Exit: 0 swapped; 3 not permitted (EPERM/EACCES: App Management, or ownership); 4 not supported
 * here (EXDEV/ENOTSUP/EINVAL: different volumes, or not APFS); 1 anything else; 2 usage.
 */
#include <errno.h>
#include <stdio.h>
#include <string.h>

int renamex_np(const char *from, const char *to, unsigned int flags);
#ifndef RENAME_SWAP
#define RENAME_SWAP 0x00000002
#endif

int main(int argc, char **argv) {
  if (argc != 3) {
    fprintf(stderr, "usage: chattered-swap A B\n");
    return 2;
  }
  if (renamex_np(argv[1], argv[2], RENAME_SWAP) == 0) return 0;
  int e = errno;
  fprintf(stderr, "swap failed: %s\n", strerror(e));
  if (e == EPERM || e == EACCES) return 3;
  if (e == EXDEV || e == ENOTSUP || e == EINVAL) return 4;
  return 1;
}
