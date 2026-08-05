/*
 * LeetCode 815 - Bus Routes
 * Canonical URL: https://leetcode.com/problems/bus-routes/
 *
 * Problem:
 * routes[i] lists the stops visited by bus i in a repeating cycle. You may
 * board any bus at a stop and leave it at any later stop on that route. Return
 * the minimum number of buses needed to travel from source to target, or -1 if
 * it is impossible. Riding one bus through many stops still counts as one bus.
 *
 * Constraints:
 * - 1 <= routes.length <= 500
 * - 1 <= routes[i].length <= 10^5
 * - The total number of listed stops is at most 10^5
 * - 0 <= routes[i][j], source, target <= 10^6

 * Example:
 * routes = [[1,2,7], [3,6,7]], source = 1, target = 6 -> 2
 *
 *     Bus 0: 1 ── 2 ── 7
 *                       ╲ transfer
 *     Bus 1:       3 ── 6 ── 7
 *     Ride bus 0 to stop 7, then bus 1 to stop 6.
 *
 * The natural graph has stops as vertices and buses as hyperedges; BFS by bus
 * layers counts transfers/boardings rather than individual stop moves.
 * Starter scaffold:
 */
class Solution {
    public int numBusesToDestination(int[][] routes, int source, int target) {
        return 0;
    }
}
