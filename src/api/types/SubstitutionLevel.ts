import { constants } from '../../shared'

export const returns: typeof constants.CONTEXT.returns.symbol = constants.CONTEXT.returns.symbol
export const throws: typeof constants.CONTEXT.throws.symbol = constants.CONTEXT.throws.symbol
export const resolves: typeof constants.CONTEXT.resolves.symbol = constants.CONTEXT.resolves.symbol
export const rejects: typeof constants.CONTEXT.rejects.symbol = constants.CONTEXT.rejects.symbol
export const mimicks: typeof constants.CONTEXT.mimicks.symbol = constants.CONTEXT.mimicks.symbol

type OneArgumentRequiredFunction<TArgs, TReturnType> = (requiredInput: TArgs, ...restInputs: TArgs[]) => TReturnType;

type MockObjectPromise<TReturnType> = TReturnType extends Promise<infer U> ? (
  (TReturnType extends { resolves: any } ? 
      { [resolves]: OneArgumentRequiredFunction<U, void> } :
      { resolves: OneArgumentRequiredFunction<U, void> }) &
  (TReturnType extends { rejects: any } ? 
      { [rejects]: OneArgumentRequiredFunction<any, void> } :
      { rejects: OneArgumentRequiredFunction<any, void> })
) : {}

type BaseMockObjectMixin<TObject, TReturnType> = 
  MockObjectPromise<TReturnType> & 
  (
      (TObject extends { returns: any } ? 
          { [returns]: OneArgumentRequiredFunction<TReturnType, void> } :
          { returns: OneArgumentRequiredFunction<TReturnType, void> }) &
      (TObject extends { throws: any } ? 
          { [throws]: OneArgumentRequiredFunction<any, never> } :
          { throws: OneArgumentRequiredFunction<any, never> })
  )

export type NoArgumentMockObjectMixin<TObject, TReturnType> = 
  BaseMockObjectMixin<TObject, TReturnType> & 
  (TObject extends { mimicks: any } ? 
      { [mimicks]: OneArgumentRequiredFunction<() => TReturnType, void> } :
      { mimicks: OneArgumentRequiredFunction<() => TReturnType, void> })

export type MockObjectMixin<TObject, TArguments extends any[], TReturnType> = 
  BaseMockObjectMixin<TObject, TReturnType> & 
  (TReturnType extends { mimicks: any } ? 
      { [mimicks]: OneArgumentRequiredFunction<(...args: TArguments) => TReturnType, void> } :
      { mimicks: OneArgumentRequiredFunction<(...args: TArguments) => TReturnType, void> })
