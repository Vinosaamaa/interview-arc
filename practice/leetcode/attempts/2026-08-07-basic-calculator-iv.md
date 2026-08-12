---
schema_version: 1
activity_id: 2026-08-06-extra-basic-calculator-iv-msikcqrx-0
question_id: basic-calculator-iv
solution_profile_revision: 2
finalization_revision: 2
date: 2026-08-07
practice_timezone: America/Los_Angeles
type: leetcode
source: extra
record_kind: attempt
title: "Basic Calculator IV"
url: https://leetcode.com/problems/basic-calculator-iv/
topics: [recursive-descent, polynomial, symbolic-algebra, hash-map]
status: completed
allocated_seconds: 2700
timing_source: website
elapsed_seconds: 3567
started_at: 2026-08-06T23:34:26.281-07:00
ended_at: 2026-08-07T01:19:22.590-07:00
user_attempted: true
outcome: failed
assistance_level: full_solution
audio_clips:
  - id: clip-3ed43435-c0c2-49f2-a5cf-7564f92922b2
    transcript_turn_id: voice-df7e7dda-7f14-4782-9051-56b0bba69642
  - id: clip-6f745b06-1d7e-43cb-8b2f-8bd1fbd26bf6
    transcript_turn_id: voice-fa949b22-866b-44dc-a6e6-ef46051644b7
  - id: clip-e87a3070-f0c6-4208-9e1c-8799f59601a0
    transcript_turn_id: voice-b527fb71-4be4-4c3f-8450-c87853048e92
audio_availability: private-r2
---

# Basic Calculator IV

## Pinned Notes

No pinned notes were recorded.

## Problem Reference

[Basic Calculator IV](https://leetcode.com/problems/basic-calculator-iv/)

## Summary

When an evaluator must return symbolic output, first replace the scalar value type with an algebraic object that supports the required operators. Then parse normally.

Outcome: failed. Elapsed time: 3567 seconds.

No interaction-mode classification snapshot was stored on this legacy finalization.

## Activity Exchanges

> **User:**
> we start basic calculator iv

> **Specialist:**
> Basic Calculator IV is ready.
>
> The problem asks you to parse an expression containing integers, variables, `+`, `-`, `*`, spaces, and nested parentheses. Substitute variables listed in `evalvars`, simplify the remaining symbolic polynomial, combine like terms, and return its nonzero terms in canonical order: descending degree, then lexicographic variable order.
>
> Required API:
>
> ```java
> public List<String> basicCalculatorIV(
>     String expression,
>     String[] evalvars,
>     int[] evalints
> )
> ```
>
> Editor command:
>
> ```sh
> nvim "$(
> printf %s \
> "Prep/.worktrees/" \
> "arc-batch-hard20-20260805/" \
> "practice/leetcode/solutions/" \
> "0770-basic-calculator-iv.java"
> )"
> ```
>
> Quick test:
>
> ```sh
> node "$(
> printf %s \
> "Prep/interview-arc/scripts/" \
> )" run \
> --activity-id \
> "2026-08-06-extra-basic-calculator-iv-"\
> "msikcqrx-0" \
> --generation-id \
> "413a64eb813c56ba4e56"
> ```
>
> Full test:
>
> ```sh
> node "$(
> printf %s \
> "Prep/interview-arc/scripts/" \
> )" run \
> --activity-id \
> "2026-08-06-extra-basic-calculator-iv-"\
> "msikcqrx-0" \
> --generation-id \
> "413a64eb813c56ba4e56" \
> --full
> ```
>
> The authoritative timer is running at revision 1. Interview mode is Interviewer. The dedicated LeetCode tab is open on the canonical Basic Calculator IV page, and the harness is preparing in the background.

> **User:**
> Yeah, I took a little break. Now let's get back to this. Let's go back to this one. All right. How do we think of this one? First, just, this is not, first, we don't have divide. We don't have division. Parenthesis, plus, minus, and multiply. All the tokens in expression are separated by single plus. That's actually not... Uh... A chunk is user expression in parentheses. A variable or a non-negative integer. What? A chunk is either an expression in parentheses. A variable or a non-negative integer. A variable is a string of lower cases. Can be multiple and note that variables never have a leading coefficient or unary operator. on screen. Text on screen. Thank you Bipolar Text on Text on screen. Bid Bid Bid screen. Bid Bid Bid Okay, we're still recording, all right? Ah. I have no fucking idea how to do that. So think of it this way. I have no fucking idea how to do this, okay? Text Oh. right, let's see how do we do this step by step, okay? So for each of the variables, there is no coefficient, okay? But, as parenthesis, and we have IV there. So what do you think? shit. I was thinking, because it is separated by space every time, so. I was thinking the first split by fucking... The first split by space. Text on Text on screen. So, split, first we split, right? on screen. Text Text on screen. Okay, so first I'm thinking we need to, I don't know if it's right or wrong. So first we need to subize all the, substitute all the evaluate variable with the evaluate int. You can do that easily with the cyber token. I can use the string split. And then, of course, some may contain a little bit of half parentheses. So we need to take that into consideration as well. Let's substitute, subitizing that. Oh my god, this problem. Subitize. Play part of the... . All right, suppose after substitution, how do we do that? After substitution, okay. So we have some coefficient, you know, we still have some variable, right? When we have this kind of variable, what do we do? I mean, it's easy for just the minus. Is it easy for minus plus? Do we actually do the kind of, you know, because this is different. You can, ah, you can not like just calculate what inside the parentheses. You need to expand those. God damn it, bruh. Oh no. Just no way, right? Do it actually start? Shit. Oh no no, I don't actually, I have no idea. Let's go straight to mental mode, okay?

> **Specialist:**
> The first key decision is the value returned by every parsing helper: not an integer and not a string, but a polynomial.
>
> Represent a polynomial as a map:
>
> ```text
> monomial -> coefficient
> ```
>
> A monomial is one multiplied variable sequence stored in sorted order. Examples:
>
> ```text
> 5             => { []       -> 5 }
> a             => { [a]      -> 1 }
> a * b         => { [a, b]   -> 1 }
> 2*a*b - 3*a+5 => { [a, b]   -> 2,
>                     [a]      -> -3,
>                     []       -> 5 }
> ```
>
> The empty variable list `[]` represents a constant. If `e` has a supplied value of `3`, parsing the atom `e` returns `{[] -> 3}`. If `e` is not supplied, it returns `{[e] -> 1}`. Therefore substitution happens naturally while parsing each variable; you do not need to rewrite the expression first.
>
> This abstraction also neutralizes parentheses: parsing the expression inside parentheses returns another polynomial map, which the outer expression can add, subtract, or multiply.
>
> Do not commit to `split(" ")` yet. It does not solve precedence or nested parentheses, and parentheses may be attached to adjacent chunks. We will choose the parser after the polynomial operations are clear.
>
> Your next mentor step is only this: suppose the left polynomial is `a + 2` and the right polynomial is `b + 3`. Using the map representation, what four monomials and coefficients should multiplication produce?

> **User:**
> First of all, this is all. What are these fucking monomers, polynomials, what the fuck is this, bro? Oh my god, I'm laughing. Okay. Okay, okay, so. It's saying left polynomial is A plus 2 and the right polynomial B plus 3. Using the what four monomials are and the coefficients should multiplication... Oh, you're saying you want to multiply them. I mean, of course. You know the thing, right? Of course you know what is it, but how do we actually... Oh, so you are saying like... So anything that is something like this parentheses... Interesting. So you are presenting just A multiply B as A, B, two elements in an array. That's not bad actually. Yeah, that's not bad because if in this way, How, oh no. Yeah, okay. In this way, I mean, it's a for loop, right? It's a for loop. You have to merge them. The flow is essentially provided four of the different, four array corresponding, four keys, right? Four keys, and you have to merge them. You have to merge them according to, if they are the same key You actually merge them Is that what you saying here Is that what you saying I mean you can present that in actually give me some idea Let see like how do we present just the normal How do we actually present plus, minus? So each of them is just corresponding to this kind of polynomial stuff, right? Monomial. monomule. Each of them corresponding to one monomule key and value. And unusual flow. Ha. So unusual flow. Where do we actually store all this shit, man? You're saying that we store all of them in a hash map for all the things inside one parenthesis? And? Oh my gosh. Are we storing each pair? I'm thinking maybe we store each pair in an array. It's definitely not pair, right? Do we store the pair in array, but in a stack? No way, bro. No, no, no, we store in a hash map because we need to look up the key. If the key is the same, we need to multiply something. But, okay, if we do that sequentially, yeah I mean we got if we do the recursion okay like we did we do the recursion we we did we do the recursion if we meet our parentheses we enter the recursion And the recursion will return a hash map. And we will decide on... I think this is just fucking stupid. So if a hash map... Well, it's essentially just a true map. We look into the... So you're saying we can just do it sequentially? You are doing it sequentially if it's a map after the map returned. Oh my god, if that's like sequential, how do we... We just keep adding to that map? So first we create an empty map. And then we just, oh, okay. Yeah, right. We just create an empty map. And then we're just adding these kind of pairs into adding a key value. Key value to the hash map. For just normal things, we just, I mean, for just normal things, we just, I mean, we But there is a gap, right? Yeah, there's a gap. How can we do multiply If that just a plus and minus that okay But how do we actually do it Actually oh my God this is so hard If we can see the multiply, that would be so hard. We cannot do that sequentially. We need to remember the previous. Isn't that just bad? Uh... I mean, we still have this kernel, you know. Text on screen. Text on screen. What if we do a fucking stack, bro? I have no idea, bro.

> **Specialist:**
> First, the vocabulary:
>
> - A monomial is one product term, such as `3*a*b`. Its coefficient is `3`; its variable key is `[a,b]`.
> - A polynomial is a sum of monomials, such as `3*a*b - 2*a + 5`.
>
> So one polynomial can be represented as:
>
> ```java
> Map<List<String>, Integer>
> ```
>
> The immutable, sorted variable list is the key; the integer coefficient is the value.
>
> For your multiplication example:
>
> ```text
> a + 2  => { [a] -> 1, [] -> 2 }
> b + 3  => { [b] -> 1, [] -> 3 }
> ```
>
> Multiplication uses two nested loops—every left entry with every right entry:
>
> ```text
> [a] × [b] => [a,b] coefficient 1
> [a] × []  => [a]   coefficient 3
> []  × [b] => [b]   coefficient 2
> []  × []  => []    coefficient 6
> ```
>
> Therefore:
>
> ```text
> (a + 2)(b + 3) = a*b + 3*a + 2*b + 6
> ```
>
> If two products generate the same variable key, add their coefficients with `map.merge(key, coefficient, Integer::sum)`.
>
> The precedence problem is solved by three parser levels:
>
> ```text
> expression = term   ((+ or -) term)*
> term       = factor (* factor)*
> factor     = number | variable | '(' expression ')'
> ```
>
> Every level returns the same polynomial-map type:
>
> - `parseExpression()` handles addition and subtraction.
> - `parseTerm()` handles multiplication.
> - `parseFactor()` handles one number, variable, or parenthesized expression.
>
> That is why sequential parsing works. `parseExpression` never combines raw factors itself; it asks `parseTerm` to completely consume multiplication first. When `parseFactor` sees `(`, it recursively calls `parseExpression` and the Java call stack remembers where to return. No explicit stack is necessary.
>
> Your next step is not the full implementation. Write only these three method signatures returning your polynomial type, then tell me what input each method should stop at:
>
> ```java
> Poly parseExpression();
> Poly parseTerm();
> Poly parseFactor();
> ```

> **User:**
> Okay, okay, I think this is way out of time now. And yeah, just give me the answer, okay? Give me the answer and yeah, also let's just finish this. I'll mark this as failed, okay? So just let's do the final review part. Give me the answer, do the review, editorial,

> **Specialist:**
> ## Final review
>
> You correctly identified several important pieces before stopping:
>
> - Known variables should become constants.
> - Unknown variables must remain symbolic.
> - Like terms need a hash-based representation so their coefficients can be merged.
> - Parentheses naturally suggest recursion.
> - Multiplication is the difficult operation because it distributes every term on the left over every term on the right.
>
> The missing organizing idea was to separate the problem into two independent layers: polynomial arithmetic and expression parsing. Once `Poly` supports addition, subtraction, and multiplication, parsing becomes an ordinary precedence parser whose values happen to be polynomials instead of integers.
>
> The attempt is correctly classified as failed because you did not reach an implementable parser or final source. No Code Attempt should be created from the untouched starter.
>
> ## Editorial comparison
>
> The authenticated LeetCode Editorial was available and presents one approach: a `Poly` class backed by a map from a sorted list of free variables to an integer coefficient. It defines polynomial addition, subtraction, multiplication, evaluation, formatting, and a parser that combines polynomial values.
>
> That matches the representation and parser direction we reached in mentoring. The implementation below is independently written and uses recursive descent with three precedence levels rather than reproducing the Editorial code.
>
> ## Reference implementation
>
> ```java
> import java.util.*;
>
> class Solution {
>     private String expression;
>     private int index;
>     private Map<String, Integer> substitutions;
>
>     public List<String> basicCalculatorIV(
>         String expression,
>         String[] evalvars,
>         int[] evalints
>     ) {
>         this.expression = expression;
>         this.index = 0;
>         this.substitutions = new HashMap<>();
>
>         for (int i = 0; i < evalvars.length; i++) {
>             substitutions.put(evalvars[i], evalints[i]);
>         }
>
>         return parseExpression().toList();
>     }
>
>     // expression = term ((+ or -) term)*
>     private Poly parseExpression() {
>         Poly result = parseTerm();
>
>         while (true) {
>             skipSpaces();
>             if (index >= expression.length() || expression.charAt(index) == ')') {
>                 return result;
>             }
>
>             char operator = expression.charAt(index);
>             if (operator != '+' && operator != '-') {
>                 return result;
>             }
>
>             index++;
>             Poly right = parseTerm();
>             result = operator == '+'
>                 ? result.add(right)
>                 : result.subtract(right);
>         }
>     }
>
>     // term = factor (* factor)*
>     private Poly parseTerm() {
>         Poly result = parseFactor();
>
>         while (true) {
>             skipSpaces();
>             if (index >= expression.length() || expression.charAt(index) != '*') {
>                 return result;
>             }
>
>             index++;
>             result = result.multiply(parseFactor());
>         }
>     }
>
>     // factor = number | variable | '(' expression ')'
>     private Poly parseFactor() {
>         skipSpaces();
>         char current = expression.charAt(index);
>
>         if (current == '(') {
>             index++;
>             Poly inside = parseExpression();
>             skipSpaces();
>             index++; // consume ')'
>             return inside;
>         }
>
>         if (Character.isDigit(current)) {
>             int value = 0;
>             while (
>                 index < expression.length()
>                     && Character.isDigit(expression.charAt(index))
>             ) {
>                 value = value * 10 + expression.charAt(index++) - '0';
>             }
>             return Poly.constant(value);
>         }
>
>         int start = index;
>         while (
>             index < expression.length()
>                 && Character.isLowerCase(expression.charAt(index))
>         ) {
>             index++;
>         }
>
>         String variable = expression.substring(start, index);
>         Integer value = substitutions.get(variable);
>         return value == null
>             ? Poly.variable(variable)
>             : Poly.constant(value);
>     }
>
>     private void skipSpaces() {
>         while (
>             index < expression.length()
>                 && expression.charAt(index) == ' '
>         ) {
>             index++;
>         }
>     }
>
>     private static class Poly {
>         private final Map<String, Integer> terms;
>
>         private Poly() {
>             terms = new HashMap<>();
>         }
>
>         private static Poly constant(int value) {
>             Poly polynomial = new Poly();
>             polynomial.addTerm("", value);
>             return polynomial;
>         }
>
>         private static Poly variable(String name) {
>             Poly polynomial = new Poly();
>             polynomial.addTerm(name, 1);
>             return polynomial;
>         }
>
>         private Poly add(Poly other) {
>             Poly result = copy();
>             for (Map.Entry<String, Integer> entry : other.terms.entrySet()) {
>                 result.addTerm(entry.getKey(), entry.getValue());
>             }
>             return result;
>         }
>
>         private Poly subtract(Poly other) {
>             Poly result = copy();
>             for (Map.Entry<String, Integer> entry : other.terms.entrySet()) {
>                 result.addTerm(entry.getKey(), -entry.getValue());
>             }
>             return result;
>         }
>
>         private Poly multiply(Poly other) {
>             Poly result = new Poly();
>
>             for (Map.Entry<String, Integer> left : terms.entrySet()) {
>                 for (Map.Entry<String, Integer> right : other.terms.entrySet()) {
>                     String key = multiplyKeys(left.getKey(), right.getKey());
>                     int coefficient = left.getValue() * right.getValue();
>                     result.addTerm(key, coefficient);
>                 }
>             }
>
>             return result;
>         }
>
>         private void addTerm(String key, int coefficient) {
>             if (coefficient == 0) {
>                 return;
>             }
>
>             int updated = terms.getOrDefault(key, 0) + coefficient;
>             if (updated == 0) {
>                 terms.remove(key);
>             } else {
>                 terms.put(key, updated);
>             }
>         }
>
>         private Poly copy() {
>             Poly copy = new Poly();
>             copy.terms.putAll(terms);
>             return copy;
>         }
>
>         private List<String> toList() {
>             List<Map.Entry<String, Integer>> ordered =
>                 new ArrayList<>(terms.entrySet());
>
>             ordered.sort((first, second) -> {
>                 int degreeOrder = Integer.compare(
>                     degree(second.getKey()),
>                     degree(first.getKey())
>                 );
>                 if (degreeOrder != 0) {
>                     return degreeOrder;
>                 }
>                 return first.getKey().compareTo(second.getKey());
>             });
>
>             List<String> answer = new ArrayList<>();
>             for (Map.Entry<String, Integer> entry : ordered) {
>                 String key = entry.getKey();
>                 answer.add(
>                     key.isEmpty()
>                         ? String.valueOf(entry.getValue())
>                         : entry.getValue() + "*" + key
>                 );
>             }
>             return answer;
>         }
>
>         private static String multiplyKeys(String first, String second) {
>             if (first.isEmpty()) {
>                 return second;
>             }
>             if (second.isEmpty()) {
>                 return first;
>             }
>
>             List<String> variables = new ArrayList<>();
>             variables.addAll(Arrays.asList(first.split("\\*")));
>             variables.addAll(Arrays.asList(second.split("\\*")));
>             Collections.sort(variables);
>             return String.join("*", variables);
>         }
>
>         private static int degree(String key) {
>             if (key.isEmpty()) {
>                 return 0;
>             }
>
>             int degree = 1;
>             for (int i = 0; i < key.length(); i++) {
>                 if (key.charAt(i) == '*') {
>                     degree++;
>                 }
>             }
>             return degree;
>         }
>     }
> }
> ```
>
> ## Correctness invariant
>
> Every parser method returns the exact simplified polynomial represented by the substring it consumes. `parseFactor` is correct for one atom or parenthesized expression. `parseTerm` repeatedly multiplies complete factors, enforcing multiplication precedence. `parseExpression` then adds or subtracts complete terms. Polynomial multiplication performs the distributive Cartesian product of both term maps, canonicalizes each resulting variable sequence, and combines like terms.
>
> ## Complexity
>
> The Editorial states `O(2^N + M)` time for expression length `N` and `M` substitutions because polynomial expansion can produce exponentially many terms. It states `O(N + M)` auxiliary space. More precisely, storage is output-sensitive: if expansion creates `P` distinct monomials, the polynomial maps require `O(P)` term storage in addition to parser and substitution state.
>
> ## Edge cases
>
> - Every variable is substituted, producing a constant-only result.
> - No variables are substituted.
> - Different multiplication paths produce the same monomial and must combine.
> - Coefficients cancel to zero and must be removed.
> - Repeated variables produce keys such as `a*a*b`.
> - Deeply nested parentheses.
> - Constants and zero-valued substituted variables.
> - Output ordering by descending degree, then lexicographic variable sequence.
>
> ## Alternative
>
> A shunting-yard parser can convert the expression to postfix form and evaluate it with a stack of `Poly` values. This avoids recursive-descent methods but retains exactly the same polynomial representation and arithmetic. It is useful when the operator grammar changes dynamically; for this fixed grammar, recursive descent is clearer.
>
> ## Key lesson and follow-up
>
> When an evaluator must return symbolic output, first replace the scalar value type with an algebraic object that supports the required operators. Then parse normally. Reimplement the `Poly` operations before attempting the parser again; once those three operations work, the grammar becomes routine.

## User Attempt

No structured Code Attempt snapshot was recorded for this activity.

## Agent Solution

import java.util.*;

class Solution {
    private String expression;
    private int index;
    private Map<String, Integer> substitutions;

    public List<String> basicCalculatorIV(
        String expression,
        String[] evalvars,
        int[] evalints
    ) {
        this.expression = expression;
        this.index = 0;
        this.substitutions = new HashMap<>();

        for (int i = 0; i < evalvars.length; i++) {
            substitutions.put(evalvars[i], evalints[i]);
        }

        return parseExpression().toList();
    }

    // expression = term ((+ or -) term)*
    private Poly parseExpression() {
        Poly result = parseTerm();

        while (true) {
            skipSpaces();
            if (index >= expression.length() || expression.charAt(index) == ')') {
                return result;
            }

            char operator = expression.charAt(index);
            if (operator != '+' && operator != '-') {
                return result;
            }

            index++;
            Poly right = parseTerm();
            result = operator == '+'
                ? result.add(right)
                : result.subtract(right);
        }
    }

    // term = factor (* factor)*
    private Poly parseTerm() {
        Poly result = parseFactor();

        while (true) {
            skipSpaces();
            if (index >= expression.length() || expression.charAt(index) != '*') {
                return result;
            }

            index++;
            result = result.multiply(parseFactor());
        }
    }

    // factor = number | variable | '(' expression ')'
    private Poly parseFactor() {
        skipSpaces();
        char current = expression.charAt(index);

        if (current == '(') {
            index++;
            Poly inside = parseExpression();
            skipSpaces();
            index++; // consume ')'
            return inside;
        }

        if (Character.isDigit(current)) {
            int value = 0;
            while (
                index < expression.length()
                    && Character.isDigit(expression.charAt(index))
            ) {
                value = value * 10 + expression.charAt(index++) - '0';
            }
            return Poly.constant(value);
        }

        int start = index;
        while (
            index < expression.length()
                && Character.isLowerCase(expression.charAt(index))
        ) {
            index++;
        }

        String variable = expression.substring(start, index);
        Integer value = substitutions.get(variable);
        return value == null
            ? Poly.variable(variable)
            : Poly.constant(value);
    }

    private void skipSpaces() {
        while (
            index < expression.length()
                && expression.charAt(index) == ' '
        ) {
            index++;
        }
    }

    private static class Poly {
        private final Map<String, Integer> terms;

        private Poly() {
            terms = new HashMap<>();
        }

        private static Poly constant(int value) {
            Poly polynomial = new Poly();
            polynomial.addTerm("", value);
            return polynomial;
        }

        private static Poly variable(String name) {
            Poly polynomial = new Poly();
            polynomial.addTerm(name, 1);
            return polynomial;
        }

        private Poly add(Poly other) {
            Poly result = copy();
            for (Map.Entry<String, Integer> entry : other.terms.entrySet()) {
                result.addTerm(entry.getKey(), entry.getValue());
            }
            return result;
        }

        private Poly subtract(Poly other) {
            Poly result = copy();
            for (Map.Entry<String, Integer> entry : other.terms.entrySet()) {
                result.addTerm(entry.getKey(), -entry.getValue());
            }
            return result;
        }

        private Poly multiply(Poly other) {
            Poly result = new Poly();

            for (Map.Entry<String, Integer> left : terms.entrySet()) {
                for (Map.Entry<String, Integer> right : other.terms.entrySet()) {
                    String key = multiplyKeys(left.getKey(), right.getKey());
                    int coefficient = left.getValue() * right.getValue();
                    result.addTerm(key, coefficient);
                }
            }

            return result;
        }

        private void addTerm(String key, int coefficient) {
            if (coefficient == 0) {
                return;
            }

            int updated = terms.getOrDefault(key, 0) + coefficient;
            if (updated == 0) {
                terms.remove(key);
            } else {
                terms.put(key, updated);
            }
        }

        private Poly copy() {
            Poly copy = new Poly();
            copy.terms.putAll(terms);
            return copy;
        }

        private List<String> toList() {
            List<Map.Entry<String, Integer>> ordered =
                new ArrayList<>(terms.entrySet());

            ordered.sort((first, second) -> {
                int degreeOrder = Integer.compare(
                    degree(second.getKey()),
                    degree(first.getKey())
                );
                if (degreeOrder != 0) {
                    return degreeOrder;
                }
                return first.getKey().compareTo(second.getKey());
            });

            List<String> answer = new ArrayList<>();
            for (Map.Entry<String, Integer> entry : ordered) {
                String key = entry.getKey();
                answer.add(
                    key.isEmpty()
                        ? String.valueOf(entry.getValue())
                        : entry.getValue() + "*" + key
                );
            }
            return answer;
        }

        private static String multiplyKeys(String first, String second) {
            if (first.isEmpty()) {
                return second;
            }
            if (second.isEmpty()) {
                return first;
            }

            List<String> variables = new ArrayList<>();
            variables.addAll(Arrays.asList(first.split("\\*")));
            variables.addAll(Arrays.asList(second.split("\\*")));
            Collections.sort(variables);
            return String.join("*", variables);
        }

        private static int degree(String key) {
            if (key.isEmpty()) {
                return 0;
            }

            int degree = 1;
            for (int i = 0; i < key.length(); i++) {
                if (key.charAt(i) == '*') {
                    degree++;
                }
            }
            return degree;
        }
    }
}

### Exact Solution Profile Revision

Question `basic-calculator-iv`, revision 2.

### Pattern recognition and constraints

The expression grammar has integers, lowercase variables, substitution values, +, -, *, spaces, and nested parentheses. Because unsubstituted variables must remain symbolic and multiplication can expand the number of terms exponentially, parse into a polynomial value rather than trying to evaluate to one integer.

### Best approach

A `Poly` class backed by a map from a sorted list of free variables to an integer coefficient. It defines polynomial addition, subtraction, multiplication, evaluation, formatting, and a parser that combines polynomial values.

The implementation uses recursive descent with three precedence levels. Once `Poly` supports addition, subtraction, and multiplication, parsing becomes an ordinary precedence parser whose values happen to be polynomials instead of integers.

### Reference implementation

```java
import java.util.*;

class Solution {
    private String expression;
    private int index;
    private Map<String, Integer> substitutions;

    public List<String> basicCalculatorIV(
        String expression,
        String[] evalvars,
        int[] evalints
    ) {
        this.expression = expression;
        this.index = 0;
        this.substitutions = new HashMap<>();

        for (int i = 0; i < evalvars.length; i++) {
            substitutions.put(evalvars[i], evalints[i]);
        }

        return parseExpression().toList();
    }

    // expression = term ((+ or -) term)*
    private Poly parseExpression() {
        Poly result = parseTerm();

        while (true) {
            skipSpaces();
            if (index >= expression.length() || expression.charAt(index) == ')') {
                return result;
            }

            char operator = expression.charAt(index);
            if (operator != '+' && operator != '-') {
                return result;
            }

            index++;
            Poly right = parseTerm();
            result = operator == '+'
                ? result.add(right)
                : result.subtract(right);
        }
    }

    // term = factor (* factor)*
    private Poly parseTerm() {
        Poly result = parseFactor();

        while (true) {
            skipSpaces();
            if (index >= expression.length() || expression.charAt(index) != '*') {
                return result;
            }

            index++;
            result = result.multiply(parseFactor());
        }
    }

    // factor = number | variable | '(' expression ')'
    private Poly parseFactor() {
        skipSpaces();
        char current = expression.charAt(index);

        if (current == '(') {
            index++;
            Poly inside = parseExpression();
            skipSpaces();
            index++; // consume ')'
            return inside;
        }

        if (Character.isDigit(current)) {
            int value = 0;
            while (
                index < expression.length()
                    && Character.isDigit(expression.charAt(index))
            ) {
                value = value * 10 + expression.charAt(index++) - '0';
            }
            return Poly.constant(value);
        }

        int start = index;
        while (
            index < expression.length()
                && Character.isLowerCase(expression.charAt(index))
        ) {
            index++;
        }

        String variable = expression.substring(start, index);
        Integer value = substitutions.get(variable);
        return value == null
            ? Poly.variable(variable)
            : Poly.constant(value);
    }

    private void skipSpaces() {
        while (
            index < expression.length()
                && expression.charAt(index) == ' '
        ) {
            index++;
        }
    }

    private static class Poly {
        private final Map<String, Integer> terms;

        private Poly() {
            terms = new HashMap<>();
        }

        private static Poly constant(int value) {
            Poly polynomial = new Poly();
            polynomial.addTerm("", value);
            return polynomial;
        }

        private static Poly variable(String name) {
            Poly polynomial = new Poly();
            polynomial.addTerm(name, 1);
            return polynomial;
        }

        private Poly add(Poly other) {
            Poly result = copy();
            for (Map.Entry<String, Integer> entry : other.terms.entrySet()) {
                result.addTerm(entry.getKey(), entry.getValue());
            }
            return result;
        }

        private Poly subtract(Poly other) {
            Poly result = copy();
            for (Map.Entry<String, Integer> entry : other.terms.entrySet()) {
                result.addTerm(entry.getKey(), -entry.getValue());
            }
            return result;
        }

        private Poly multiply(Poly other) {
            Poly result = new Poly();

            for (Map.Entry<String, Integer> left : terms.entrySet()) {
                for (Map.Entry<String, Integer> right : other.terms.entrySet()) {
                    String key = multiplyKeys(left.getKey(), right.getKey());
                    int coefficient = left.getValue() * right.getValue();
                    result.addTerm(key, coefficient);
                }
            }

            return result;
        }

        private void addTerm(String key, int coefficient) {
            if (coefficient == 0) {
                return;
            }

            int updated = terms.getOrDefault(key, 0) + coefficient;
            if (updated == 0) {
                terms.remove(key);
            } else {
                terms.put(key, updated);
            }
        }

        private Poly copy() {
            Poly copy = new Poly();
            copy.terms.putAll(terms);
            return copy;
        }

        private List<String> toList() {
            List<Map.Entry<String, Integer>> ordered =
                new ArrayList<>(terms.entrySet());

            ordered.sort((first, second) -> {
                int degreeOrder = Integer.compare(
                    degree(second.getKey()),
                    degree(first.getKey())
                );
                if (degreeOrder != 0) {
                    return degreeOrder;
                }
                return first.getKey().compareTo(second.getKey());
            });

            List<String> answer = new ArrayList<>();
            for (Map.Entry<String, Integer> entry : ordered) {
                String key = entry.getKey();
                answer.add(
                    key.isEmpty()
                        ? String.valueOf(entry.getValue())
                        : entry.getValue() + "*" + key
                );
            }
            return answer;
        }

        private static String multiplyKeys(String first, String second) {
            if (first.isEmpty()) {
                return second;
            }
            if (second.isEmpty()) {
                return first;
            }

            List<String> variables = new ArrayList<>();
            variables.addAll(Arrays.asList(first.split("\\*")));
            variables.addAll(Arrays.asList(second.split("\\*")));
            Collections.sort(variables);
            return String.join("*", variables);
        }

        private static int degree(String key) {
            if (key.isEmpty()) {
                return 0;
            }

            int degree = 1;
            for (int i = 0; i < key.length(); i++) {
                if (key.charAt(i) == '*') {
                    degree++;
                }
            }
            return degree;
        }
    }
}
```

### Correctness reasoning

Every parser method returns the exact simplified polynomial represented by the substring it consumes. `parseFactor` is correct for one atom or parenthesized expression. `parseTerm` repeatedly multiplies complete factors, enforcing multiplication precedence. `parseExpression` then adds or subtracts complete terms. Polynomial multiplication performs the distributive Cartesian product of both term maps, canonicalizes each resulting variable sequence, and combines like terms.

### Time and space complexity

The Editorial states `O(2^N + M)` time for expression length `N` and `M` substitutions because polynomial expansion can produce exponentially many terms. It states `O(N + M)` auxiliary space. More precisely, storage is output-sensitive: if expansion creates `P` distinct monomials, the polynomial maps require `O(P)` term storage in addition to parser and substitution state.

### Edge cases

- Every variable is substituted, producing a constant-only result.
- No variables are substituted.
- Different multiplication paths produce the same monomial and must combine.
- Coefficients cancel to zero and must be removed.
- Repeated variables produce keys such as `a*a*b`.
- Deeply nested parentheses.
- Constants and zero-valued substituted variables.
- Output ordering by descending degree, then lexicographic variable sequence.

### Meaningful alternatives

- **Shunting-yard parser:** A shunting-yard parser can convert the expression to postfix form and evaluate it with a stack of `Poly` values. This avoids recursive-descent methods but retains exactly the same polynomial representation and arithmetic. It is useful when the operator grammar changes dynamically; for this fixed grammar, recursive descent is clearer.

### Common mistakes and recall cues

Do not tokenize only by spaces: parentheses and precedence still require a real parser. Keep every monomial key canonical by sorting its variables, merge like coefficients, remove zero coefficients, and let term parsing finish multiplication before expression parsing applies addition or subtraction. Recall cue: make the parser return Poly instead of int.

## What Went Well

- Known variables should become constants.
- Unknown variables must remain symbolic.
- Like terms need a hash-based representation so their coefficients can be merged.
- Parentheses naturally suggest recursion.
- Multiplication is the difficult operation because it distributes every term on the left over every term on the right.

## What To Improve

- The missing organizing idea was to separate the problem into two independent layers: polynomial arithmetic and expression parsing.
- Once `Poly` supports addition, subtraction, and multiplication, parsing becomes an ordinary precedence parser whose values happen to be polynomials instead of integers.
- Reimplement the `Poly` operations before attempting the parser again; once those three operations work, the grammar becomes routine.

## Review Plan

- Status: due
- Reason: failed
- Due date: 2026-08-11

## Delivery Recordings

- `clip-3ed43435-c0c2-49f2-a5cf-7564f92922b2` — transcript turn `voice-df7e7dda-7f14-4782-9051-56b0bba69642`; 1198 seconds; available.
- `clip-6f745b06-1d7e-43cb-8b2f-8bd1fbd26bf6` — transcript turn `voice-fa949b22-866b-44dc-a6e6-ef46051644b7`; 623 seconds; available.
- `clip-e87a3070-f0c6-4208-9e1c-8799f59601a0` — transcript turn `voice-b527fb71-4be4-4c3f-8450-c87853048e92`; 37 seconds; available.

## Delivery Review

### clip-6f745b06-1d7e-43cb-8b2f-8bd1fbd26bf6

Status: available.

The response shows useful live problem-solving and becomes clearest when it states a concrete representation or parser step. Across the full recording, however, speech arrives in bursts separated by long pauses; repeated fillers, sentence restarts, self-directed questions, and expletives make the reasoning harder to follow than the underlying ideas. A short restatement followed by explicit representation, operations, and parsing sections would make the delivery sound much more controlled.

- Duration: 622.94 seconds
- Pace: 60.2 words per minute

**Strengths**
- The reasoning is audible: candidate representations such as arrays, stacks, and hash maps are compared instead of being silently discarded.
- Concrete statements such as storing terms in a hash map for key lookup and returning a hash map from recursive parentheses parsing are substantially clearer than the surrounding exploration.
- Questions about multiplication and remembering the previous result identify the main unresolved parser-composition issue.

**Improvements**
- Open with a 15-second restatement, then organize the answer as representation, polynomial operations, and expression parsing.
- After a long pause or abandoned hypothesis, give one checkpoint sentence: what is known, what remains unknown, and what will be tested next.
- Replace filler-heavy restarts and expletives with brief neutral transitions such as “Let me reset,” “Current invariant,” and “The remaining case is multiplication.”
- State a hypothesis once and test it with a small example instead of repeating the same self-directed question.

**Observations**
- **pace:** The transcript contains 625 words across 622.94 seconds, or 60.2 words per minute over the full clip. The low overall rate is caused by long gaps; spoken passages themselves often arrive in quicker bursts. Coaching: Aim for steadier short reasoning blocks: one claim, one example, one conclusion, followed by a deliberate two- or three-second pause.
- **pauses:** Audio-energy inspection found repeated silent stretches of roughly 7 to 36 seconds, including about 12 seconds at 19s, 11 seconds at 237s, 10 seconds at 328s, and extended gaps after 538s. Coaching: Use silent thinking when needed, but re-enter with a recap such as “I have the term representation; now I am deciding how multiplication composes two maps.”
- **fillers:** Exact transcript counts include “okay” 8 times, “I mean” 7, “like” 5, “you know” 3, “right” 8, and “uh” once. Several occur in restart clusters. Coaching: Replace clusters with one reset phrase, then finish a complete sentence before starting the next idea.
- **clarity:** The clearest passage is the concrete explanation that a hash map supports key lookup and that recursive parsing can return a hash map. Fragments such as “four array corresponding, four keys” and repeated unfinished clauses around normal terms obscure the intended invariant. Coaching: Name each object precisely: “A monomial key is its sorted variables; the map value is its coefficient.” Then use the same nouns consistently.
- **organization:** The response revisits arrays, stacks, hash maps, recursion, sequential evaluation, and multiplication without periodic summaries, so earlier decisions are repeatedly reopened. Coaching: Use a three-part roadmap: define the polynomial map, define add/subtract/multiply, then explain recursive-descent parsing and operator precedence.
- **vocal variation:** Among speech-active audio frames, energy spans about 13 dB from the 10th to 90th percentile, so the delivery is not flat. Much of the strongest emphasis accompanies interjections and expletives rather than algorithmic conclusions. Coaching: Redirect emphasis to key terms and contrasts: “hash map,” “combine like terms,” and “multiplication composes two polynomials.”
- **perceived confidence:** Delivery sounds most decisive in complete causal statements such as storing terms in a hash map “because we need to look up the key.” Repeated self-questions, reversals, and the closing “I have no idea” weaken the confident impression. Coaching: Separate facts from open questions: state confirmed decisions declaratively, then label one remaining uncertainty and propose the next test.

### clip-e87a3070-f0c6-4208-9e1c-8799f59601a0

Status: available.

The delivery is understandable and clearly ends the attempt, but it is slow for a short handoff and becomes repetitive. Nine discourse fillers and three repetitions of the answer request soften an otherwise decisive message. A concise three-step close would sound clearer and more confident. Exact silence locations and vocal variation were not scored because the available audio inspection did not support reliable measurements.

- Duration: 37.18 seconds
- Pace: 83.9 words per minute

**Strengths**
- The intended outcome is explicit: the attempt is over and should be marked failed.
- The requested next step is recognizable: provide the answer, then conduct a final review/editorial walkthrough.

**Improvements**
- Compress the close into one structured handoff: “I’m out of time. Mark this failed. Please walk me through the solution, complexity, and key edge cases.”
- Replace repeated “okay,” “yeah,” and “just” with one intentional pause between the outcome and the review request.
- State the answer request once instead of repeating “give me the answer” three times.
- Finish the final list with a complete clause; the recording ends on “editorial,” which leaves the request sounding unfinished.

**Observations**
- **pace:** The verbatim transcript contains 52 words across 37.18 seconds, or 83.9 words per minute. Coaching: For a short administrative handoff, aim for a compact 10–15 second close built from two or three complete sentences.
- **fillers:** The transcript contains “okay” 4 times, “yeah” 2 times, and “just” 3 times: 9 discourse fillers in 52 words. Coaching: Use a brief silent beat after declaring the attempt over instead of filling the transition with “okay,” “yeah,” or “just.”
- **clarity:** “Give me the answer” appears three times, while the closing phrase ends at “review, editorial,” without completing the thought. Coaching: Make one specific request and name the review outputs: approach, invariant, complexity, and edge cases.
- **organization:** The response moves from time expiry to an answer request, then the failed outcome, then back to the answer/review request. Coaching: Use a stable order: outcome first, status second, requested next step third.
- **pauses:** The supplied word timestamps show no explicit inter-word gap of at least 0.5 seconds; several unusually long word spans make exact silence placement unreliable. Coaching: Insert one deliberate pause after “I’m out of time,” then continue with the outcome and review request.
- **perceived confidence:** The decisive statements “I’ll mark this as failed” and “give me the answer” are softened by “I think,” repeated “okay?” tags, and repeated restarts. Coaching: Use declarative phrasing once: “I’m out of time, so mark this failed. Now walk me through the solution and review.”

### clip-3ed43435-c0c2-49f2-a5cf-7564f92922b2

Status: available.

The answer has an unhurried overall rate because long thinking gaps dominate the 20-minute recording. When speaking, the delivery is understandable in short bursts, with useful restarts such as “step by step” and “after substitution,” but repeated self-interruptions, reaction language, and unannounced pauses weaken continuity and make the reasoning sound less settled than it could.

- Duration: 1197.69 seconds
- Pace: 21 words per minute

**Strengths**
- Uses explicit reset phrases—“let’s see how do we do this step by step”—to re-enter the explanation after a stall.
- Surfaces concrete reasoning checkpoints, including the operator set, variable substitution, and the need to expand parenthesized expressions.
- Classic vocalized fillers are limited: only one “uh” and two “ah” instances appear in the transcript.
- Self-corrections are spoken aloud, so a listener can usually tell which wording is intended, as in “subize… substitute.”

**Improvements**
- Before a long thinking pause, give the interviewer a one-sentence signpost such as: “I’m going to test whether tokenizing by spaces survives parentheses.”
- Replace repeated “okay/right” check-ins with content-bearing transitions: “Constraint,” “working hypothesis,” “risk,” and “next test.”
- State one complete claim before revising it. For example: “First, substitute evaluated variables. The open question is how parentheses affect tokenization.”
- Replace reaction language and profanity with calibrated uncertainty: “I don’t have the full representation yet; my current hypothesis is…”
- Use a stable verbal outline—constraints, representation, operations, validation—and announce when moving between those stages.
- Place vocal emphasis on reasoning landmarks such as “substitution” and “expand parentheses,” rather than on reaction phrases.

**Observations**
- **pace:** After excluding obvious ASR artifact phrases, the transcript contains about 412 usable words over 1197.69 seconds, or approximately 21 WPM across the full recording; this whole-recording rate includes thinking silence. Coaching: Treat this as a continuity measure, not a target speaking speed. Keep deliberate pauses, but bracket them with a short hypothesis before and a conclusion after.
- **pauses:** Word timestamps show repeated unannounced gaps, including about 27.5 seconds at 18.0s, 27.9 seconds at 106.1s, 47.3 seconds at 490.5s, and 31.1 seconds at 1145.7s. Coaching: For any pause likely to exceed roughly 10 seconds, say what you are inspecting so the silence reads as deliberate analysis.
- **fillers:** The transcript has few classic hesitation sounds (1 “uh,” 2 “ah”) but frequent listener check-ins (7 “okay,” 8 “right”) plus 2 “you know” and 1 “I mean.” Coaching: Keep the low um/uh rate and convert “okay/right” into transitions that name the purpose of the next sentence.
- **clarity:** Several clauses restart before reaching a claim: “First, just, this is not, first…” and “we need to subize all the, substitute all the…” Coaching: Pause briefly, then deliver a subject-verb-object claim. Correct terminology once and continue without repeating the entire setup.
- **organization:** The explanation moves from reading constraints to splitting by spaces, substitution, and finally parenthesis expansion, but it does not announce a stable framework connecting those steps. Coaching: Open with a four-part map—constraints, representation, operator handling, validation—and label each transition.
- **vocal variation:** The delivery shifts from neutral constraint-reading to strongly emphasized short reactions such as “What?”, “Oh my god,” and “God damn it,” while the algorithmic checkpoints receive less explicit emphasis. Coaching: Keep the natural variation, but move the strongest emphasis to the key reasoning nouns and decisions.
- **perceived confidence:** Repeated statements such as “I have no idea,” “I don’t know if it’s right or wrong,” and fragmented self-questions make tentative reasoning sound categorical or abandoned. Coaching: Use calibrated hypothesis language: “My first approach is X; the risk is Y; I’ll test it on Z.” This remains honest while sounding controlled.

## References

- [Basic Calculator IV Editorial](https://leetcode.com/problems/basic-calculator-iv/editorial/) — accessed 2026-08-07.
