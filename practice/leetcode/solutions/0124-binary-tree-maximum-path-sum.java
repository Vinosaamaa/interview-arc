/*
 * LeetCode 124 - Binary Tree Maximum Path Sum
 * Canonical URL: https://leetcode.com/problems/binary-tree-maximum-path-sum/
 *
 * Problem:
 * Return the largest sum of node values along any non-empty path in a binary
 * tree. A path follows parent-child edges, may start and end anywhere, and
 * cannot revisit a node.
 *
 * Constraints:
 * - 1..30,000 nodes
 * - -1,000 <= node.val <= 1,000
 * - Under these bounds the answer fits in a signed 32-bit integer; a wider
 *   accumulator is optional rather than required.
 *
 * Examples:
 *
 *       1                 [-10]
 *      / \                /    \
 *     2   3              9      20
 *                              /  \
 *                             15   7
 *
 * [1,2,3] -> 6          [-10,9,20,null,null,15,7] -> 42
 *
 * At each node, the path that may continue upward is one-sided (node plus the
 * better child branch), while the global candidate may join both child
 * branches through the node. Negative child contributions are discarded.
 *
 * Starter scaffold preserved from the Java editor:
 */

/**
 * Definition for a binary tree node.
 * public class TreeNode {
 *     int val;
 *     TreeNode left;
 *     TreeNode right;
 *     TreeNode() {}
 *     TreeNode(int val) { this.val = val; }
 *     TreeNode(int val, TreeNode left, TreeNode right) {
 *         this.val = val;
 *         this.left = left;
 *         this.right = right;
 *     }
 * }
 */
class Solution {
    public int maxPathSum(TreeNode root) {
        if(root == null) return 0;
        long[] ans = {root.val};
        dfs(root, ans);
        return (int) ans[0];
    }

    long dfs(TreeNode root, long[] ans){
        
        if(root == null) return 0;
        
        long L = Math.max(0L, dfs(root.left, ans));
        long R = Math.max(0L, dfs(root.right, ans));

        ans[0] = Math.max(ans[0], L+R+root.val);

        return Math.max(L+root.val, R+root.val);

    }
}
