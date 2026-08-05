/*
 * LeetCode 2334 — Subarray With Elements Greater Than Varying Threshold
 * Canonical URL: https://leetcode.com/problems/subarray-with-elements-greater-than-varying-threshold/
 *
 * Problem:
 * Given a positive integer array nums and a positive integer threshold, find
 * the length k of any non-empty contiguous subarray in which every value is
 * strictly greater than threshold / k. Return -1 if no such subarray exists.
 *
 * Constraints:
 * - 1 <= nums.length <= 100,000
 * - 1 <= nums[i], threshold <= 1,000,000,000
 *
 * Example 1:
 * nums = [1, 3, 4, 3, 1], threshold = 6
 * output = 3
 * The subarray [3, 4, 3] has length 3, and every value is greater than 2.
 *
 * Example 2:
 * nums = [6, 5, 6, 5, 8], threshold = 7
 * output = 1
 * The subarray [8] has length 1, and 8 is greater than 7.
 *
 * Monotonic-stack picture for a candidate minimum at index i:
 *     smaller ... [left boundary | nums[i] | right boundary] ... smaller
 * The maximal span where nums[i] is the minimum is the only span that needs
 * to be checked; its length k is valid when nums[i] * k > threshold.
 */

import java.util.ArrayDeque;
import java.util.Stack;

class Solution {
    public int validSubarraySize(int[] nums, int threshold) {
        if(nums.length == 0) return -1;
        ArrayDeque<Integer> st = new ArrayDeque<Integer>();
        st.push(-1);

        for(int i=0; i<=nums.length; i++){
            int next = i==nums.length ? 0 : nums[i];

            while(st.size()!=1 && nums[st.peekFirst()] > next){
                int tmp = st.pop();
                if(nums[tmp] * (i - st.peekFirst() -1L)>threshold) return i-st.peekFirst()-1;
            }
            st.push(i);;
        }

        return -1;
    }
}
