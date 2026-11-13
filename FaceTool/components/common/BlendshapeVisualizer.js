'use client';

export default function BlendshapeVisualizer({ blendshapeData, blendshapeNames }) {
  if (!blendshapeData || !blendshapeNames || blendshapeNames.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
        블렌드쉐입 데이터가 없습니다
      </div>
    );
  }

  // 블렌드쉐입 데이터에서 frame 제외
  const blendshapeEntries = Object.entries(blendshapeData)
    .filter(([key]) => key !== 'frame')
    .sort(([a], [b]) => {
      // blendshapeNames 순서대로 정렬
      const indexA = blendshapeNames.indexOf(a);
      const indexB = blendshapeNames.indexOf(b);
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });

  return (
    <div className="w-full h-full overflow-y-auto bg-gray-900 p-1">
      <div className="space-y-0.5">
        {blendshapeEntries.map(([name, value]) => {
          const displayValue = typeof value === 'number' ? value : 0;
          
          // 활성 블렌드쉐입 강조 (값이 0.01 이상)
          const isActive = displayValue > 0.01;
          
          return (
            <div 
              key={name} 
              className={`px-1 py-0.5 flex items-center justify-between text-[10px] ${
                isActive ? 'bg-gray-800' : 'bg-gray-900'
              }`}
            >
              <span className={`truncate flex-1 ${isActive ? 'text-green-400' : 'text-gray-500'}`} title={name}>
                {name.split('.').pop() || name}
              </span>
              <span className={`font-mono ml-2 ${isActive ? 'text-green-300' : 'text-gray-600'}`}>
                {displayValue.toFixed(3)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
