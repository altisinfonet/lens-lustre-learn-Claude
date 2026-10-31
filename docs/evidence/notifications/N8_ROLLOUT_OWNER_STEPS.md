# Notification centre: switching it on, step by step (for the Owner)

Every step here is a click on the website. You never need to type code.
Nothing is on until you click it, and the runner never switches anything on
for you. You can switch any row back to **Off** with one click, and that part
goes straight back to working exactly as it does today.

**Where:** sign in on www.50mmretina.com → open the menu → **Admin** →
**Notification Centre**.

At the top is a box called **Switches**. Each row has four buttons:
**Off** · **Only me** · **Chosen members** · **Everyone**. The filled-in button
shows what is on now. Every row starts at **Off**.

Do the parts **one at a time, in this order**, and wait the time shown before
starting the next part. If anything looks wrong at any point, click **Off** on
that row and tell the notifications runner what you saw. That one click is
always safe.

---

## Before you start: one thing the runner checks first

The runner confirms that the step-by-step database work for that part is
finished on the live site. It is recorded in the status note,
`docs/evidence/cloud/NOTIFICATIONS_STATUS.md`. If that note doesn't say a
part is ready, leave that row at **Off**.

## Part 1: the new notification screens (how things look)

1. On the row **New notification screens**, click **Only me**.
2. Open the bell and the Notifications page on your phone and on your computer. Check:
   - each notification is one tap and opens the right post;
   - names are in bold;
   - unread ones have a small dot;
   - the Notifications page has tabs: **All**, **Comments & mentions**, **Follows**, **Competitions**;
   - competition and award notifications start with a short headline, with the details underneath;
   - wins and features show as a highlighted card.
3. Open **Notification settings**. You should see one table with **Bell**, **Phone** and **E-mail** columns.
   Under it is **Quiet hours**: set times when your phone stays silent. Notifications still appear in the bell.
4. If you are happy after a day: ask the runner for the member ids of 3–5 trusted members, paste them
   into the box on that row, and click **Chosen members**.
5. After 2 days with no complaints, click **Everyone**.

## Part 2: likes and comments (the first group run through the centre)

1. On the row **Likes and comments**, click **Only me**.
2. Ask a friend to like and comment on one of your photos. Check:
   - you get exactly one notification for each (no doubles);
   - it says the right thing;
   - your phone gets a push if you allow pushes;
   - no push arrives during your quiet hours.
3. The next day: **Chosen members** (the same few members as in Part 1).
4. Two days after that: **Everyone**.

From this part on, the 4 **In-app** settings people choose in Notification
settings start to work for that group. Today they do nothing.

## Part 3: follows and friends

Same four steps on the row **Follows and friends**:
1. **Only me**.
2. Test it: ask a friend to follow you and to send you a friend request.
3. **Chosen members**.
4. **Everyone**.

## Part 4: competitions and judging

Same four steps on **Competitions and judging**. Do this in a week when no
results are being published, so a mistake can't land on a results day.

## Part 5: announcements, then account, then wallet / support / roles

One row at a time, with the same steps for each.

## Part 6: admin alerts

This row only has **Off** and **Everyone**, because all admins share one alert
list. Click **Everyone** last, once everything above has been on for everyone
for a few days.

---

## Changing a notification for everyone

The **Notification types** list sits under the switches:
- untick **On** to stop that kind of notification for everyone;
- click **Edit** to:
  - choose **Bell**, **Phone push** or **E-mail**;
  - change the wording (you see a preview first);
  - press **Send a test to me**;
- the change history shows who changed what, and when.

The numbers beside each type show how many were written in the last 24 hours
and 7 days, and what the centre sent or skipped.

## Helping a member

**Look up a member's notification settings** is at the bottom of the page.
Paste their member id and click **Look up**. It only shows their settings
(including their quiet hours) and changes nothing.

## If pushes stop working

Once a group is on, the site keeps a receipt for each push. If most pushes in
an hour fail, an alarm called **notif_push_failing** opens on the operations
alarm list, and the runner is told. You don't need to do anything for the
alarm itself.

---

*For the runner (not for the Owner):*
- **When a group first goes Everyone:** remove that group's `inapp_*` entries from `UNWIRED_TOGGLES` in
  `src/__tests__/notificationPreferenceWiring.test.ts`. When the last of them is gone, also remove the 0110
  exemption there. Those settings are then genuinely read.
- **Before any group is switched on:**
  - 0170 (#780) must be applied on that lane, so that push obeys the member's settings and quiet hours;
  - 0160 (#777) must be applied, for receipts and the alarm;
  - the edge deploy needs the Owner's `SUPABASE_ACCESS_TOKEN` (Owner list item 1).
- Never switch anything on yourself.
