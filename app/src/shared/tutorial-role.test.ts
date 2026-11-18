/**
 * The role a new source is guessed to have (`guessSourceRole`), over the file names participants'
 * courses use (field-study red team, 2026-11-18). An answer sheet guessed as a lecture is read into
 * the notes and the help, answers and all; an exam guessed as a lecture is never read as a sheet.
 */
import { describe, expect, it } from 'vitest';
import { guessSourceRole } from './tutorial.js';

/** An exam's text: numbered on lines of their own, as the CS1010 practice paper is. */
const EXAM = Array.from({ length: 12 }, (_, i) => `${i + 1}.\nAY2020/21 Semester 1 Midterm\n\nWhat will the program print?\n\nAnswer:\n`).join('\n');
/** Its answer sheet: the same numbering, an answer under each. */
const ANSWERS = Array.from({ length: 12 }, (_, i) => `${i + 1}.\n  A. Each division is integer division.\n`).join('\n');
/** A lecture deck's text: long, no numbered questions. */
const LECTURE = 'Pointers and memory. A pointer holds an address. '.repeat(800);

describe('guessing what a source is', () => {
  it.each([
    ['CS1010-Finals-Practice-Questions.pdf', EXAM, 'tutorial'],
    ['CS1010-Finals-Practice-Solutions.pdf', ANSWERS, 'solutions'],
    ['CS2040S_Tut3_answers.pdf', ANSWERS, 'solutions'],
    ['T3_solutions.pdf', ANSWERS, 'solutions'],
    ['Tutorial 3 Solutions.pdf', ANSWERS, 'solutions'],
    ['CS2100_Tutorial_5_Ans.pdf', ANSWERS, 'solutions'],
    ['cs2030s-2324-s1-final.pdf', EXAM, 'tutorial'],
    ['MA1521 PYP 2022.pdf', EXAM, 'tutorial'],
    ['tut03.pdf', EXAM, 'tutorial'],
    ['Lab 4.pdf', EXAM, 'tutorial'],
    ['Week 5 Tutorial.pdf', EXAM, 'tutorial'],
    ['CS3249+Lecture+4.pdf', LECTURE, 'lecture'],
    ['L05 Pointers.pdf', LECTURE, 'lecture'],
    ['Final review lecture.pdf', LECTURE, 'lecture'],
    // The acceptance test's names (2026-11-19): a lecture's name wins over its title's words.
    ['Lecture 5 - Answer Set Programming.pdf', LECTURE, 'lecture'],
    ['L7 Solutions of ODEs.pdf', 'Separable equations\nIntegrating factor', 'lecture'],
    ['Lecture 10 Final Review.pdf', '1.\nPointers recap\n2.\nRecursion recap\n3.\nWhat to expect\n', 'lecture'],
    ['CS2103 L9 Unit Tests.pdf', '1.\nPointers recap\n2.\nRecursion recap\n3.\nWhat to expect\n', 'lecture'],
    ['Week 4 Lab Answer Key.pdf', 'Lab 4', 'solutions'],
    ['Quiz 2.pdf', '1.\nWhat is x?\n2.\nWhat is y?\n', 'tutorial'],
    ['IMG_2041.png', '', 'lecture'],
    ['Midterm 2025 with answers.pdf', '1.\nQ\n2.\nQ\n', 'tutorial'],
    ['Tutorial 4 Questions and Answers.pdf', 'Question 1\n', 'tutorial'],
  ])('%s', (name, text, role) => {
    expect(guessSourceRole(name, text)).toBe(role);
  });
});
