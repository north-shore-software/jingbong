# Jingbong user guide

Jingbong is a bot that works on Linear issues. For each issue it works in the
repositories the issue is routed to (see [Repositories](#repositories)), both
public and private.

Setting Jingbong up is covered in [SETUP_COMMENT_MODE.md](./SETUP_COMMENT_MODE.md).

## The basics

- Talk to Jingbong by writing `@jingbong` in a comment on an issue. Every new
  request needs the mention, even in a thread Jingbong is already in. The one
  exception: when Jingbong asks you a question, just reply.
- A 👀 on your comment means Jingbong has picked up the request. It replies in
  that comment's thread. The first line of each reply records which code
  version, session and model it used; you can ignore it.
- It always writes in English. When it quotes text in another language, it
  gives the English translation with the original in parentheses.
- It never changes the issue's status.

## Commands

| Command | What it does |
| --- | --- |
| `@jingbong <anything>` | Ask a question or request work in plain words. |
| `@jingbong cp [focus]` | **Checkpoint.** Reads the whole issue and replies with a suggested title, a write-up of what's been decided, and any open questions. |
| `@jingbong opt <question>` | **Options.** Lays out every reasonable way to settle a question, with pros and cons and no recommendation. |
| `@jingbong build [guidance]` | **Build.** Implements the issue and opens a pull request. |
| `@jingbong repo [name…]` | **Repository.** Chooses the issue's repositories; with no name, says which ones it uses. |

### Repositories

Every request works in the issue's repositories. Jingbong picks them in this
order:

1. A `[repo=<name>]` tag in the issue description (one tag per repository).
2. The issue's Linear project, for repositories configured with that project
   name in `projectKeys`.
3. Every repository in the workspace that has no routing set up (catch-all).

If none of these match, Jingbong replies that it doesn't know which repository
the issue belongs to, lists the ones it can use, and holds the request. Reply
`@jingbong repo <name>` (or several names) and it adds the `[repo=…]` tag to the
description, replacing any earlier tag, then carries on with the held request.
Held requests are forgotten if Jingbong restarts; just ask again.

`@jingbong repo` also changes the repositories of an issue that already has
them. A conversation already running in a thread keeps the repositories it
started with; start a new thread to use the new ones.

### Checkpoints (`cp`)

- Each open question is posted as its own new comment thread. To answer, just
  reply in that thread, without `@jingbong`.
- Run `cp` again whenever you like. The newest conclusion wins. Answered
  questions aren't asked again, and older unanswered ones are carried forward.
- React ✅ on the write-up to copy it into the issue's title and description.
  The old title and description are kept in a collapsed section of the
  confirmation reply. ✅ also closes the `cp` thread and the questions you
  answered.

### Options (`opt`)

- The answer always starts a new thread. The first comment states the
  question and what the decision depends on. Each option is a separate reply.
- 👍 the option you pick. Later checkpoints treat it as the decision.
- Write `@jingbong opt` with no question inside a discussion thread to get
  options for whatever that thread is trying to decide.
- Shortcut: react 🤔 on any comment to run `opt` with that comment as the
  question.

### Build (`build`)

- Jingbong works from the issue's title and description plus any text after
  `build`, not from the comments, so get the description right first, ideally
  with `cp` then ✅.
- It creates a branch called `jingbong/<issue-id>-<name>` from the latest
  `main`. It picks which repo or repos need changes, runs the checks, and opens
  one PR per changed repo. Commits and PRs are made by Jingbong's GitHub App
  bot account.
- Where the issue is unclear, it makes a sensible guess rather than asking,
  and lists its guesses in the PR.
- If checks still fail after it tries to fix them, the PR is opened as a
  draft.
- When it's done, it replies with the PR links. It never merges anything;
  reviewing and merging is up to you.
- Running `build` again always makes a new branch and PR (`-2`, `-3`…). Older
  branches and PRs are never overwritten.
- A PR in a public repo never mentions a private repo.

## Reactions

| On | Reaction | Effect |
| --- | --- | --- |
| A `cp` write-up | ✅ | Copies it into the issue's title and description |
| Any comment | 🤔 | Runs `opt` on that comment |
| A Jingbong comment | 👍 | Marks it as agreed; checkpoints count it |

## Suggested flow

Discuss on the issue → `@jingbong cp` → answer its questions (using `opt` or 🤔
where you're stuck) → `cp` again → ✅ the write-up → `@jingbong build` →
review the PR.

## Reactions in detail

Only reactions from people count; reactions from bots and apps are ignored.
Removing a reaction never undoes anything.

### ✅ (check mark)

**When it works:** on a Jingbong `cp` write-up, meaning the reply that starts
with **Suggested title:** and has a **Write-up** section. On any other comment
it does nothing.

**What happens:**

1. The issue title becomes the suggested title.
2. The issue description becomes the write-up, without its heading and
   without the open-questions part.
3. A reply, "✅ Applied…", goes in the `cp` thread. The old title and
   description are kept in a collapsed section.
   - If the issue already matches the write-up, steps 1 to 3 are skipped.
     Nothing changes and nothing is posted.
4. The `cp` thread is resolved, but only if it starts with your
   `@jingbong cp` comment. If you ran `cp` as a reply inside a discussion,
   that discussion stays open.
5. Answered open questions from that same `cp` run are resolved. That means
   questions posted after this write-up and before the next one, where someone
   replied without mentioning Jingbong. Unanswered questions stay open until
   the next `cp`.

**Be careful:** ✅ on an older write-up overwrites the description with that
older version. To undo, copy the newer one back from the collapsed section of
the "Applied" reply.

### 🤔 (thinking face)

**When it works:** on any comment, whether you, a teammate or Jingbong wrote
it.

Only the first 🤔 on a comment counts. A second one, or someone else's, does
nothing.

**What happens:**

1. It runs `opt`, using that comment's text as the question.
2. Thread context: if the comment is a reply inside a thread, the thread up to
   and including that reply is read as background.
3. Output: it posts a new thread that quotes the comment, then the question
   and what decides it, then each option as its own reply.

It changes nothing else: not the issue, not other threads, and no 👀.

### 👍 (thumbs up)

**When it works:** on Jingbong's comments. On anyone else's comment it has no
effect, because checkpoints always read people's comments.

**Nothing happens at the time:** no reply, and the issue isn't changed.

**What it affects later:** what future `cp` and `opt` runs read.

- Jingbong's comments are ignored by checkpoints unless someone 👍'd them. A
  👍'd comment counts as agreed.
- On an `opt` option reply, 👍 marks it as the option chosen. Later
  checkpoints treat it as the decision.
- Remove the 👍 before the next `cp` and it no longer counts.

### Any other reaction

No effect. The 👀 that Jingbong adds to your comment only means it has picked
up your request.
