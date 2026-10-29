cmake_minimum_required(VERSION 3.21)
project(designer_backend LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Designer's private headers are used on purpose (see README); the build is tied to this exact Qt version.
set(QT_NO_PRIVATE_MODULE_WARNING ON)
find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets Xml Designer DesignerPrivate DesignerComponentsPrivate)

add_executable(poc src/poc_main.cpp)
target_link_libraries(poc PRIVATE
    Qt6::Core Qt6::Gui Qt6::Widgets Qt6::Xml Qt6::Designer Qt6::DesignerComponentsPrivate)

add_executable(designer_backend src/backend_main.cpp)
# SetPropertyCommand and friends are exported by libQt6Designer but their header is not installed:
# use the header from the Qt 6.11.3 sources vendored in this repository (same version, same ABI).
target_include_directories(designer_backend PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../vendor/qttools/src/designer/src/lib/shared)
target_link_libraries(designer_backend PRIVATE
    Qt6::Core Qt6::Gui Qt6::Widgets Qt6::Xml Qt6::Designer Qt6::DesignerPrivate Qt6::DesignerComponentsPrivate)
