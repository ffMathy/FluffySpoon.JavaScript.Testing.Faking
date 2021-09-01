export const getCorrectConstructorDescriptor = () => {
  const nodeVersionLowerThan12 = Number(process.versions.node.split('.')[0]) < 12;
  return nodeVersionLowerThan12 ?
    'Function:' :
    'Function:';//'class';
};