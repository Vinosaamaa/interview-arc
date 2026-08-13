---
type: leetcode
title: Basic Calculator — Solution Profile revision 2
date: 2026-08-12
status: published
solution_profile_revision: 2
previous_solution_profile_revision: 1
question_id: basic-calculator
problem_number: 224
---

# Basic Calculator — Solution Profile revision 2

> Corrected canonical solution reference. It is not a new practice attempt. The historical activity, transcript, timer, result, finalization, and activity-to-solution link remain pinned to Solution Profile revision 1.

## Summary

Evaluate the expression in one left-to-right pass by maintaining the current subtotal, the sign for the next value, the number being parsed, and a stack of outer subtotal/sign contexts for parentheses.

## Pattern recognition and constraints

This is expression parsing, but the grammar is deliberately narrower than a general calculator: values are non-negative decimal integers; the only binary operators are addition and subtraction; parentheses may nest; spaces may appear anywhere; unary minus is legal; unary plus and consecutive operators are not. Because multiplication and division are absent, there is no precedence tier inside one parenthesis level. A running subtotal plus one pending sign completely represents the evaluated prefix. The input can contain 300,000 characters, so the preferred Java solution must avoid recursion depth proportional to nesting. Every number and intermediate result fits a signed 32-bit integer, so Java int arithmetic is sufficient under the stated contract.

## Best approach

Scan once from left to right with four pieces of state. `number` is the multi-digit integer currently being assembled. `sign` is `+1` or `-1` and belongs to the next completed number or parenthesized value. `result` is the subtotal of all fully committed terms in the current parenthesis level. The stack stores two integers for every open parenthesis: first the outer subtotal and then the sign that applies to the entire inner expression. On a digit, extend `number`. On `+` or `-`, commit `sign * number` into `result`, clear `number`, and remember the new sign. On `(`, push the current `result` and `sign`, then reset to a fresh inner context. On `)`, first commit the final inner number, then restore and combine the saved context as `outerResult + outerSign * innerResult`. After the scan, flush the final pending number. This explicit state machine handles unary minus without a special parser branch: before `-(...)`, the minus simply becomes the saved `outerSign`; before `-7`, it becomes the sign applied when `7` is committed.

## Reference implementations

The Java and Python versions implement the same transition order. In particular, the stack push order is outer subtotal followed by outer sign, so the sign is popped first when a parenthesis closes. Both implementations independently flush the final number after the scan.

```java
import java.util.ArrayDeque;
import java.util.Deque;

class Solution {
    public int calculate(String s) {
        Deque<Integer> stack = new ArrayDeque<>();
        int result = 0;
        int sign = 1;
        int number = 0;

        for (int i = 0; i < s.length(); i++) {
            char token = s.charAt(i);

            if (Character.isDigit(token)) {
                number = number * 10 + (token - '0');
            } else if (token == '+' || token == '-') {
                result += sign * number;
                number = 0;
                sign = token == '+' ? 1 : -1;
            } else if (token == '(') {
                stack.push(result);
                stack.push(sign);
                result = 0;
                sign = 1;
            } else if (token == ')') {
                result += sign * number;
                number = 0;

                int outerSign = stack.pop();
                int outerResult = stack.pop();
                result = outerResult + outerSign * result;
                sign = 1;
            }
        }

        return result + sign * number;
    }
}
```

```python
class Solution:
    def calculate(self, s: str) -> int:
        stack: list[int] = []
        result = 0
        sign = 1
        number = 0

        for token in s:
            if token.isdigit():
                number = number * 10 + int(token)
            elif token == "+" or token == "-":
                result += sign * number
                number = 0
                sign = 1 if token == "+" else -1
            elif token == "(":
                stack.append(result)
                stack.append(sign)
                result = 0
                sign = 1
            elif token == ")":
                result += sign * number
                number = 0

                outer_sign = stack.pop()
                outer_result = stack.pop()
                result = outer_result + outer_sign * result
                sign = 1

        return result + sign * number
```

## Correctness reasoning

Invariant for the current parenthesis level: immediately before processing each token, `result` equals the value of every fully committed term in that level; `number` is exactly the numeric value of the consecutive digits read since the last delimiter; and `sign` is the multiplier that must be applied when that number or the next parenthesized value is committed. Each digit preserves the invariant by extending only `number`. A plus or minus preserves it by committing the complete pending term and recording the next multiplier. An opening parenthesis saves the complete outer invariant and establishes the valid empty inner state. At a closing parenthesis, the final inner term is committed, so `result` is the correct value of the entire inner expression by induction over its tokens. Restoring the saved pair and computing `outerResult + outerSign * innerResult` therefore commits exactly the parenthesized term to the outer level and re-establishes the invariant there. After the final flush, no term remains pending; thus `result + sign * number` is the value of the complete expression.

## Time and space complexity

Time is O(n), where n is the expression length: every character is inspected once and every stack entry is pushed and popped once. Space is O(h), where h is the maximum parenthesis nesting depth, because each open level stores exactly two integers. Since h can be O(n), worst-case auxiliary space is O(n). The algorithm does not allocate token strings or recurse, which matters for a 300,000-character deeply nested expression.

## Edge cases

Test transitions, not only ordinary arithmetic:

- A single or final number with no trailing operator, such as `42`, proves the end-of-input flush.
- Leading unary minus on a number or group, such as `-7` and `-(2+3)`, proves that zero plus a pending negative sign is sufficient.
- Nested subtraction, such as `1-(2-(3-4))`, exposes an incorrect outer-sign restore or reversed stack order.
- Arbitrary spaces, such as ` 2-1 + 2 `, must be ignored without flushing or changing state.
- Multi-digit values, such as `123-(45+6)`, prove digits are accumulated rather than committed individually.
- Parentheses adjacent to operators, including `(1)+(2)` and `1-(-2)`, prove a closed group behaves exactly like one signed value.
- Maximum-depth nesting is a reason to prefer the iterative stack over recursive descent in Java.

## Meaningful alternatives

### Alternative: Recursive-descent parser with one shared index

#### When and why to choose it
Choose recursive descent when the grammar itself is the main teaching goal, the maximum nesting depth is safely bounded, or the calculator will soon grow explicit grammar functions. The control flow mirrors the rule “an expression is signed values separated by plus or minus,” so many interviewers find it easier to derive and explain than manual context restoration.

#### Algorithm
Keep one mutable index shared by recursive calls. `parseExpression` owns the subtotal, pending sign, and current number for exactly one parenthesis level. Digits extend the number; a sign commits that number and sets the next sign. When `(` appears, recursively parse until its matching `)`, treat the returned inner value as the current number, and let the next operator or end-of-level commit it. When `)` appears, stop the current call. Finally return the subtotal plus the last signed value.

#### Invariant and correctness
Within one invocation, before every token, `result` is the value of all complete terms in that level, while `sign * number` is its only uncommitted term. A recursive call consumes exactly one balanced parenthesized substring and returns its correct value by induction on nesting depth. Substituting that value for one number preserves the same invariant. The base level ends at input exhaustion, so its final flush proves the returned value equals the complete expression.

#### Complexity
Time is O(n) because the shared index advances across every character exactly once. Auxiliary space is O(h) for h recursive calls, which is O(n) in the worst case. In Java, that worst case can overflow the call stack even though the algorithmic bound is correct.

#### Edge cases
Check an empty-looking inner prefix created by unary minus, deeply nested groups, a number immediately before `)`, spaces around every token, and a final number at end of input. The valid-input guarantee means each recursive call will encounter either its matching close or the end of the top-level expression.

#### Tradeoffs versus preferred
This version expresses the grammar directly and becomes a natural foundation for additional precedence functions. The preferred iterative stack is safer for the stated 300,000-character limit because heap-backed stack storage avoids Java call-stack overflow. The iterative version also makes saved outer state explicit, whereas the recursive version hides that state in call frames and a shared mutable index.

#### Reference implementation
```java
class Solution {
    private int index;

    public int calculate(String s) {
        index = 0;
        return parseExpression(s);
    }

    private int parseExpression(String s) {
        int result = 0;
        int sign = 1;
        int number = 0;

        while (index < s.length()) {
            char token = s.charAt(index++);

            if (Character.isDigit(token)) {
                number = number * 10 + (token - '0');
            } else if (token == '+' || token == '-') {
                result += sign * number;
                number = 0;
                sign = token == '+' ? 1 : -1;
            } else if (token == '(') {
                number = parseExpression(s);
            } else if (token == ')') {
                break;
            }
        }

        return result + sign * number;
    }
}
```

### Alternative: Distribute accumulated sign contexts

#### When and why to choose it
Choose sign distribution when you want the smallest arithmetic state and want to exploit the fact that this grammar has only addition and subtraction. Instead of saving an outer subtotal, convert every parsed number immediately into its final global sign. This is a useful contrast because it derives a different invariant rather than merely changing stack syntax.

#### Algorithm
Store the effective sign of each open parenthesis context on a stack, beginning with `+1`. Keep `nextSign`, the local plus or minus before the next value. On `(`, push `contextSign * nextSign`; on `)`, pop that context. Parse each complete multi-digit number in one inner loop and immediately add `contextSigns.peek() * nextSign * number` to the global result. Reset `nextSign` after consuming a number or opening a group.

#### Invariant and correctness
The product at the top of the stack equals the product of every sign attached to currently open parenthesized groups. Therefore `contextSign * nextSign` is exactly the global coefficient of the next numeric literal. Addition and subtraction are associative under signed-term expansion, so adding each literal with that coefficient produces the same value as evaluating nested subtotals. Push and pop preserve the sign product at each balanced boundary; consequently the accumulated global result is correct after the final literal.

#### Complexity
Time is O(n): the outer index and digit-scanning inner loop together consume each character once. Space is O(h) for the parenthesis sign stack and O(n) in the worst case. It is iterative and therefore avoids recursion-depth failure.

#### Edge cases
Test a negative group at the beginning, alternating nested subtraction such as `1-(2-(3-4))`, multi-digit numbers, whitespace between signs and groups, and a negative value inside a negative context such as `1-(-2)`. Resetting `nextSign` at the right moment is essential.

#### Tradeoffs versus preferred
This approach stores one integer per nesting level and commits numbers immediately, so it is compact and elegant for plus/minus-only expressions. The preferred subtotal/context algorithm maps more directly to conventional expression evaluation and is easier to extend conceptually. Sign distribution does not generalize naturally to multiplication, division, or other precedence levels because those operators cannot be reduced to one accumulated coefficient.

#### Reference implementation
```java
import java.util.ArrayDeque;
import java.util.Deque;

class Solution {
    public int calculate(String s) {
        Deque<Integer> contextSigns = new ArrayDeque<>();
        contextSigns.push(1);
        int result = 0;
        int nextSign = 1;
        int index = 0;

        while (index < s.length()) {
            char token = s.charAt(index);

            if (token == ' ') {
                index++;
            } else if (token == '+') {
                nextSign = 1;
                index++;
            } else if (token == '-') {
                nextSign = -1;
                index++;
            } else if (token == '(') {
                contextSigns.push(contextSigns.peek() * nextSign);
                nextSign = 1;
                index++;
            } else if (token == ')') {
                contextSigns.pop();
                index++;
            } else {
                int number = 0;
                while (index < s.length()
                        && Character.isDigit(s.charAt(index))) {
                    number = number * 10 + (s.charAt(index) - '0');
                    index++;
                }
                result += contextSigns.peek() * nextSign * number;
                nextSign = 1;
            }
        }

        return result;
    }
}
```

## Common mistakes and recall cues

The most common failure is importing Calculator II/III state—such as a previous multiplicative term—into a grammar that has only plus and minus. That creates variables without invariants. Another bug is forgetting to flush `number` before changing `sign`, closing a group, or returning at end of input. A third is pushing and popping the context pair inconsistently; write the order beside the stack operations. Do not treat generated reference code as the user's Code Attempt: this historical activity contains reasoning and a mentor walkthrough but no submitted Java source. Recall the preferred state in one sentence: “subtotal, pending sign, current number; parentheses save and restore subtotal plus sign.” Then validate it aloud on `1-(2-3)` before coding.

## Interview walkthrough

Start by narrowing the grammar: there are only plus, minus, spaces, integers, and nested parentheses, so one subtotal and one pending sign are enough per level. Define the invariant before naming the stack. Then describe the four transitions—extend a number, flush on a sign, save and reset on `(`, finish and restore on `)`—and trace `1-(2-3)`: save outer subtotal `1` and sign `-1`; compute inner `-1`; restore to obtain `1 + (-1 * -1) = 2`. Mention that the same rule handles `-(2+3)` without special casing unary minus. State O(n) time and O(h) space, with O(n) worst-case nesting. Close by naming recursive descent as the grammar-shaped alternative and explaining why the iterative stack is preferred for a possible 300,000-character nesting depth.

## References

LeetCode 224 — Basic Calculator, official problem description and constraints, consulted 2026-08-12: https://leetcode.com/problems/basic-calculator/. The implementation and explanation are independently written; no protected Editorial prose or official solution code is reproduced.

## Revision boundary

- Current reusable Solution Profile: revision 2
- Historical completed activity Solution Profile: revision 1
- User Code Attempt created by this correction: no
- Historical Code Attempt available: no; the authoritative record contains no submitted owner code
- Transcript, timer, result, finalization, recordings, delivery analysis, and publication receipt changed: no
