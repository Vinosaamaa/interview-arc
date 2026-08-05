/*
 * LeetCode 297 — Serialize and Deserialize Binary Tree
 * Canonical URL: https://leetcode.com/problems/serialize-and-deserialize-binary-tree/
 *
 * Problem:
 * Design a reversible representation for a binary tree. serialize(root) must
 * produce a string, and deserialize(data) must reconstruct a tree with exactly
 * the same values and left/right-child structure. The encoding format is your
 * choice.
 *
 * Constraints:
 * - The tree contains 0 to 10,000 nodes.
 * - Each node value is between -1,000 and 1,000.
 *
 * Example 1:
 *
 *       1
 *      / \
 *     2   3
 *        / \
 *       4   5
 *
 * Input:  root = [1,2,3,null,null,4,5]
 * Output: [1,2,3,null,null,4,5]
 *
 * Example 2:
 * Input:  root = []
 * Output: []
 *
 * Level-order picture:
 *     1
 *    / \
 *   2   3
 *      / \
 *     4   5
 * A null marker is emitted for each absent child, preserving shape rather
 * than only the preorder sequence of values. The delimiter must distinguish
 * adjacent multi-digit and negative values.
 */

/**
 * Definition for a binary tree node.
 * public class TreeNode {
 *     int val;
 *     TreeNode left;
 *     TreeNode right;
 *     TreeNode(int x) { val = x; }
 * }
 */
public class Codec {

    // Encodes a tree to a single string.
    public String serialize(TreeNode root) {
        StringBuilder sb = new StringBuilder();
        Queue<TreeNode> q = new LinkedList<>();
        q.offer(root);
        while(q.size()!=0){
            int sz = q.size();

            for(int i=0; i<sz; i++){
                TreeNode cur = q.poll();
                if(cur == null) sb.append("#|");
                else{
                    sb.append(cur.val).append("|");
                    q.offer(cur.left);
                    q.offer(cur.right);
                }
            }
        }
        return sb.toString();
    }
    // Decodes your encoded data to tree.
    public TreeNode deserialize(String data) {
        String[] sp = data.split("\\|");
        if(sp[0].equals("#")) return null;
        int i = 0;
        TreeNode root = new TreeNode(Integer.valueOf(sp[i++]));
        Queue<TreeNode> q = new LinkedList<>();
        q.offer(root);
        while(i<sp.length){
            
            int sz = q.size();

            for(int ii=0; ii<sz; ii++){
                TreeNode cur = q.poll();

                if(!sp[i].equals("#")){
                    cur.left = new TreeNode(Integer.valueOf(sp[i]));
                    q.offer(cur.left);
                }
                i++;
                if(!sp[i].equals("#")){
                    cur.right = new TreeNode(Integer.valueOf(sp[i]));
                    q.offer(cur.right);
                 }
                i++;
            }
        }

        return root;
    }
}

// Your Codec object will be instantiated and called as such:
// Codec ser = new Codec();
// Codec deser = new Codec();
// TreeNode ans = deser.deserialize(ser.serialize(root));
