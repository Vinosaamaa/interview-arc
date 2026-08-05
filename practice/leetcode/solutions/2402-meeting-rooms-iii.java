/*
 * LeetCode 2402 - Meeting Rooms III
 * Canonical URL: https://leetcode.com/problems/meeting-rooms-iii/
 *
 * Problem:
 * There are n rooms numbered 0..n-1 and meetings [start, end). Assign each
 * meeting in start-time order. If rooms are free, use the free room with the
 * smallest number. If none are free, delay the meeting until the earliest
 * room becomes available; among ties use the smallest room number. Return the
 * room that hosted the most meetings, breaking ties by smallest number.
 *
 * Constraints:
 * - 1 <= n <= 100
 * - 1 <= meetings.length <= 100,000
 * - 0 <= start < end <= 500,000
 * - All meeting start times are distinct
 *
 * Example:
 * n = 2, meetings = [[0,10],[1,5],[2,7],[3,4]] -> 0
 *
 *     room 0: [0────────10] [10─14]   (delayed meeting)
 *     room 1:       [1──5] [5──10]
 *     At time 3 both rooms are occupied, so [3,4] waits for room 1 at 5;
 *     availability and room-id priority determine each assignment.
 *
 * Two priority queues model the state: free room ids ordered by id, and busy
 * rooms ordered by release time then id.
 * Starter scaffold:
 */
class Solution {
    public int mostBooked(int n, int[][] meetings) {
        return 0;
    }
}
